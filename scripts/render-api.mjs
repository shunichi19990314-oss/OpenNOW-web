/**
 * Render API helper for deployment automation.
 *
 * Used by `scripts/render-status.mjs` and the `render-deploy.yml` workflow.
 * Nothing here ever logs the API key: requests only carry it in the
 * Authorization header, and error messages report the HTTP status only.
 *
 * API reference: https://api.render.com/v1  (https://render.com/docs/api)
 */

export const RENDER_API_BASE = "https://api.render.com/v1";

/** Deploy statuses that mean "this deploy is over, one way or another". */
export const TERMINAL_DEPLOY_STATUSES = Object.freeze([
  "live",
  "build_failed",
  "update_failed",
  "canceled",
  "deactivated",
  "pre_deploy_failed",
]);

/** Deploy statuses that mean "still building or rolling out". */
export const ACTIVE_DEPLOY_STATUSES = Object.freeze([
  "created",
  "queued",
  "build_in_progress",
  "update_in_progress",
  "pre_deploy_in_progress",
]);

export class RenderApiError extends Error {
  /** @param {number} status @param {string} path @param {string} [detail] */
  constructor(status, path, detail) {
    super(
      `Render API ${status} for ${path}${detail ? `: ${detail}` : ""}. `
      + "Check that RENDER_API_KEY is valid and RENDER_SERVICE_ID belongs to this account.",
    );
    this.name = "RenderApiError";
    this.status = status;
    this.path = path;
  }
}

/**
 * Normalize a user-supplied service identifier into the bare `srv-...` id.
 *
 * The Render dashboard exposes several shapes, and copy/paste from the URL bar
 * or the dashboard header is the common case:
 *   srv-abc123
 *   https://dashboard.render.com/web/srv-abc123
 *   https://dashboard.render.com/web/srv-abc123/deploys/deploy-xyz
 *   srv-abc123/environment/env-xyz
 * Returns null when no id can be recognized.
 */
export function parseServiceId(raw) {
  if (typeof raw !== "string") return null;
  const match = raw.trim().match(/srv-[a-z0-9]+/i);
  return match ? match[0] : null;
}

/** Build the authenticated API client used by the CLI helpers. */
export function createRenderClient(apiKey, options = {}) {
  const baseUrl = options.baseUrl ?? RENDER_API_BASE;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  if (!apiKey) {
    throw new Error("RENDER_API_KEY is required.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available (Node.js 22+ is required).");
  }

  /** @param {string} path @param {{method?: string, body?: unknown}} [init] */
  async function request(path, init = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${apiKey}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      let detail = "";
      try {
        const payload = await response.json();
        // Render returns { message } or { errors: [{ message }] }; never echo
        // headers or the request body (they can contain the key on retries).
        detail = payload?.message
          ?? (Array.isArray(payload?.errors) ? payload.errors.map((entry) => entry?.message).filter(Boolean).join("; ") : "");
      } catch {
        // Non-JSON error bodies are not useful; the status code is enough.
      }
      throw new RenderApiError(response.status, path, detail);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  return {
    request,
    /** https://api-docs.render.com/reference/retrieve-service */
    getService: (serviceId) => request(`/services/${encodeURIComponent(serviceId)}`),
    /** https://api-docs.render.com/reference/list-deploys (newest first) */
    listDeploys: (serviceId, { limit = 10 } = {}) => request(
      `/services/${encodeURIComponent(serviceId)}/deploys?limit=${limit}`,
    ),
    /** https://api-docs.render.com/reference/retrieve-deploy */
    getDeploy: (serviceId, deployId) => request(
      `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`,
    ),
    /** https://api-docs.render.com/reference/create-deploy */
    createDeploy: (serviceId, body = {}) => {
      if (!serviceId) throw new Error("A service id is required to trigger a deploy.");
      const payload = {};
      // `commitId` and `deployMode: deploy_only` are mutually exclusive per the
      // API docs; mirror that so a stray combination cannot 400 in CI.
      if (body.commitId) payload.commitId = body.commitId;
      if (body.clearCache) payload.clearCache = "clear";
      if (!body.commitId && body.deployMode) payload.deployMode = body.deployMode;
      if (body.buildId) payload.buildId = body.buildId;
      return request(`/services/${encodeURIComponent(serviceId)}/deploys`, {
        method: "POST",
        body: payload,
      });
    },
    /** https://api-docs.render.com/reference/restart-service */
    restartService: (serviceId) => request(`/services/${encodeURIComponent(serviceId)}/restart`, {
      method: "POST",
      body: {},
    }),
  };
}

/** Render wraps list responses as `[{ deploy, cursor }]` or `[{ service }]`. */
export function unwrapList(payload) {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((entry) => entry?.deploy ?? entry?.service ?? entry)
    .filter((entry) => entry && typeof entry === "object");
}

/** Short SHA comparison that tolerates abbreviated hashes. */
export function commitMatches(deployCommitId, expectedCommit) {
  const actual = String(deployCommitId ?? "").trim().toLowerCase();
  const expected = String(expectedCommit ?? "").trim().toLowerCase();
  if (!actual || !expected) return false;
  return actual.startsWith(expected) || expected.startsWith(actual);
}

/**
 * Find the deploy that shipped a specific commit.
 * Returns `{ deploy, isNewest }` or null when that commit has no deploy yet.
 */
export function findDeployForCommit(deploys, commitId) {
  const list = Array.isArray(deploys) ? deploys : [];
  const index = list.findIndex((entry) => commitMatches(entry?.commit?.id, commitId));
  if (index < 0) return null;
  return { deploy: list[index], isNewest: index === 0 };
}

/**
 * Normalize the many shapes Render uses for "auto deploy" into one boolean.
 * The dashboard/API has used `autoDeploy: "yes" | "no"` (deprecated) and
 * `autoDeployTrigger: "commit" | "checksPass" | "off"`.
 */
export function normalizeAutoDeploy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["yes", "commit", "checkspass", "true", "on"].includes(normalized)) return true;
  if (["no", "off", "false"].includes(normalized)) return false;
  return null;
}

/** Normalize `suspended: "suspended" | "not_suspended"` (or a boolean). */
export function normalizeSuspended(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase() === "suspended";
}

/**
 * Current configuration of a service, reduced to what we care about.
 *
 * Field locations differ between `GET /services/{id}` (mostly top level) and
 * the create/update payloads (nested under `serviceDetails`), so both are read.
 */
export function summarizeService(service) {
  const details = service?.serviceDetails ?? {};
  const repo = service?.repo ?? details.repo ?? null;
  return {
    id: service?.id ?? null,
    name: service?.name ?? null,
    type: service?.type ?? null,
    repo,
    branch: service?.branch ?? details.branch ?? null,
    autoDeploy: normalizeAutoDeploy(service?.autoDeployTrigger)
      ?? normalizeAutoDeploy(service?.autoDeploy)
      ?? normalizeAutoDeploy(details.autoDeployTrigger)
      ?? normalizeAutoDeploy(details.autoDeploy),
    url: details.url ?? null,
    dashboardUrl: service?.dashboardUrl ?? null,
    region: details.region ?? service?.region ?? null,
    runtime: details.runtime ?? details.env ?? null,
    plan: details.plan ?? null,
    suspended: normalizeSuspended(service?.suspended ?? details.suspended),
    healthCheckPath: details.healthCheckPath ?? null,
    numInstances: details.numInstances ?? null,
  };
}

/**
 * Render env var groups return `{ envVar: { key, value }, cursor }`.
 * Returns a key -> value map (secrets come back redacted by the API when the
 * key has no read access, which is fine for presence checks).
 */
export function toEnvVarMap(payload) {
  const map = {};
  if (!Array.isArray(payload)) return map;
  for (const entry of payload) {
    const envVar = entry?.envVar ?? entry;
    if (envVar && typeof envVar.key === "string") {
      map[envVar.key] = envVar.value ?? "";
    }
  }
  return map;
}
