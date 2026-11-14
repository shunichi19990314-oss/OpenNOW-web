import { describe, expect, it } from "vitest";

import {
  commitMatches,
  createRenderClient,
  findDeployForCommit,
  normalizeAutoDeploy,
  normalizeSuspended,
  parseServiceId,
  RenderApiError,
  summarizeService,
  TERMINAL_DEPLOY_STATUSES,
  toEnvVarMap,
  unwrapList,
} from "./render-api.mjs";

function jsonResponse(body, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  };
}

function createStubFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, authorization: init.headers.Authorization, body: init.body });
    for (const [matcher, handler] of handlers) {
      if (typeof matcher === "string" ? url.endsWith(matcher) : matcher.test(url)) {
        return handler(url, init);
      }
    }
    return jsonResponse({ message: "not found" }, 404);
  };
  return { fetchImpl, calls };
}

const SERVICE = {
  id: "srv-abc123",
  name: "opennow-private",
  type: "web_service",
  repo: "https://github.com/shunichi19990314-oss/OpenNOW-web",
  branch: "main",
  autoDeploy: "yes",
  autoDeployTrigger: "commit",
  suspended: "not_suspended",
  dashboardUrl: "https://dashboard.render.com/web/srv-abc123",
  serviceDetails: {
    env: "node",
    plan: "free",
    region: "singapore",
    numInstances: 1,
    url: "https://opennow-private.onrender.com",
    healthCheckPath: "/api/health",
  },
};

const LIVE_DEPLOY = {
  id: "dep-live",
  status: "live",
  trigger: "new_commit",
  commit: { id: "7ef95916bc01ca9fe62a706f1f375eda476f65b0", message: "Merge pull request #2\n\nbody" },
  startedAt: "2026-11-14T09:09:00Z",
  finishedAt: "2026-11-14T09:10:00Z",
};

describe("parseServiceId", () => {
  it("accepts a bare id", () => {
    expect(parseServiceId("srv-cuk123abc")).toBe("srv-cuk123abc");
    expect(parseServiceId("  srv-abc  ")).toBe("srv-abc");
  });

  it("extracts the id from dashboard URLs", () => {
    expect(parseServiceId("https://dashboard.render.com/web/srv-abc123")).toBe("srv-abc123");
    expect(parseServiceId("https://dashboard.render.com/web/srv-abc123/deploys/deploy-xyz")).toBe("srv-abc123");
    expect(parseServiceId("srv-abc123/environment/env-1")).toBe("srv-abc123");
  });

  it("returns null for anything unrecognizable", () => {
    expect(parseServiceId("opennow-private")).toBe(null);
    expect(parseServiceId("")).toBe(null);
    expect(parseServiceId(undefined)).toBe(null);
  });
});

describe("summarizeService", () => {
  it("reads the top-level shape returned by GET /services/{id}", () => {
    const summary = summarizeService(SERVICE);
    expect(summary.name).toBe("opennow-private");
    expect(summary.branch).toBe("main");
    expect(summary.autoDeploy).toBe(true);
    expect(summary.suspended).toBe(false);
    expect(summary.url).toBe("https://opennow-private.onrender.com");
    expect(summary.healthCheckPath).toBe("/api/health");
  });

  it("falls back to serviceDetails' nested fields", () => {
    const summary = summarizeService({
      id: "srv-1",
      serviceDetails: { repo: "https://github.com/x/y", branch: "develop", autoDeploy: "no", url: "https://a.example" },
    });
    expect(summary.repo).toBe("https://github.com/x/y");
    expect(summary.branch).toBe("develop");
    expect(summary.autoDeploy).toBe(false);
  });

  it("tolerates an empty payload", () => {
    expect(summarizeService(null).name).toBe(null);
    expect(summarizeService({}).autoDeploy).toBe(null);
  });
});

describe("normalizers", () => {
  it("maps every documented autoDeploy spelling", () => {
    expect(normalizeAutoDeploy("yes")).toBe(true);
    expect(normalizeAutoDeploy("commit")).toBe(true);
    expect(normalizeAutoDeploy("checksPass")).toBe(true);
    expect(normalizeAutoDeploy("no")).toBe(false);
    expect(normalizeAutoDeploy("off")).toBe(false);
    expect(normalizeAutoDeploy(undefined)).toBe(null);
  });

  it("maps the suspended enum", () => {
    expect(normalizeSuspended("suspended")).toBe(true);
    expect(normalizeSuspended("not_suspended")).toBe(false);
    expect(normalizeSuspended(true)).toBe(true);
    expect(normalizeSuspended(undefined)).toBe(null);
  });
});

describe("deploy helpers", () => {
  it("unwraps Render's cursor envelopes", () => {
    expect(unwrapList([{ deploy: { id: "a" }, cursor: "c1" }, { deploy: { id: "b" }, cursor: "c2" }])).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
    expect(unwrapList([{ service: { id: "srv-1" } }])).toEqual([{ id: "srv-1" }]);
    expect(unwrapList(null)).toEqual([]);
  });

  it("matches abbreviated and full SHAs in both directions", () => {
    expect(commitMatches("7ef95916bc01ca9fe62a706f1f375eda476f65b0", "7ef9591")).toBe(true);
    expect(commitMatches("7ef9591", "7ef95916bc01ca9fe62a706f1f375eda476f65b0")).toBe(true);
    expect(commitMatches("7ef9591", "026ecff")).toBe(false);
    expect(commitMatches("", "7ef9591")).toBe(false);
  });

  it("finds the deploy for a commit and reports whether it is newest", () => {
    const deploys = [LIVE_DEPLOY, { ...LIVE_DEPLOY, id: "dep-old", commit: { id: "026ecffaaaa" } }];
    expect(findDeployForCommit(deploys, "7ef9591")?.deploy.id).toBe("dep-live");
    expect(findDeployForCommit(deploys, "7ef9591")?.isNewest).toBe(true);
    expect(findDeployForCommit(deploys, "026ecff")?.isNewest).toBe(false);
    expect(findDeployForCommit(deploys, "deadbeef")).toBe(null);
  });

  it("flags terminal statuses so polling always ends", () => {
    for (const status of ["live", "build_failed", "update_failed", "canceled"]) {
      expect(TERMINAL_DEPLOY_STATUSES).toContain(status);
    }
    expect(TERMINAL_DEPLOY_STATUSES).not.toContain("build_in_progress");
  });

  it("flattens env var envelopes", () => {
    expect(toEnvVarMap([
      { envVar: { key: "NODE_ENV", value: "production" }, cursor: "a" },
      { envVar: { key: "OPENNOW_ORIGIN", value: "https://example.test" }, cursor: "b" },
    ])).toEqual({ NODE_ENV: "production", OPENNOW_ORIGIN: "https://example.test" });
    expect(toEnvVarMap(undefined)).toEqual({});
  });
});

describe("createRenderClient", () => {
  it("sends the bearer token and never puts it in the URL", async () => {
    const { fetchImpl, calls } = createStubFetch([["/services/srv-abc123", () => jsonResponse({ service: SERVICE })]]);
    const client = createRenderClient("key-123", { fetchImpl });
    const payload = await client.getService("srv-abc123");

    expect(payload.service.name).toBe("opennow-private");
    expect(calls[0].authorization).toBe("Bearer key-123");
    expect(calls[0].url).toBe("https://api.render.com/v1/services/srv-abc123");
    expect(calls[0].url).not.toContain("key-123");
  });

  it("refuses to run without a key", () => {
    expect(() => createRenderClient("")).toThrow(/RENDER_API_KEY/);
  });

  it("surfaces the HTTP status without leaking the key", async () => {
    const { fetchImpl } = createStubFetch([[/\/services\//, () => jsonResponse({ message: "invalid token" }, 401)]]);
    const client = createRenderClient("super-secret", { fetchImpl });
    await expect(client.getService("srv-abc123")).rejects.toBeInstanceOf(RenderApiError);
    await expect(client.getService("srv-abc123")).rejects.toThrow(/401.*invalid token/);
    await expect(client.getService("srv-abc123")).rejects.not.toThrow(/super-secret/);
  });

  it("builds a deploy body that respects the API's mutually exclusive fields", async () => {
    const { fetchImpl, calls } = createStubFetch([[/\/deploys$/, () => jsonResponse({ deploy: { id: "dep-new" } }, 201)]]);
    const client = createRenderClient("key-123", { fetchImpl });

    await client.createDeploy("srv-abc123", { commitId: "7ef9591", deployMode: "deploy_only", clearCache: "clear" });
    const body = JSON.parse(calls[0].body);
    expect(calls[0].method).toBe("POST");
    // commitId and deployMode cannot be combined per the API docs.
    expect(body).toEqual({ commitId: "7ef9591", clearCache: "clear" });

    await client.createDeploy("srv-abc123", { clearCache: "clear" });
    expect(JSON.parse(calls[1].body)).toEqual({ clearCache: "clear" });
  });
});
