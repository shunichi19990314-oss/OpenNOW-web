#!/usr/bin/env node
/**
 * Render deployment status / deploy trigger CLI.
 *
 * Why this exists: the GitHub Actions `render-deploy.yml` workflow verifies that
 * a merge actually reached production by comparing the deployed commit against
 * `/api/health`. This script is the same logic usable locally, so a deploy can
 * be inspected or re-triggered without opening the Render dashboard.
 *
 * Usage:
 *   RENDER_API_KEY=... RENDER_SERVICE_ID=srv-... node scripts/render-status.mjs
 *   RENDER_API_KEY=... RENDER_SERVICE_ID=srv-... node scripts/render-status.mjs --wait
 *   RENDER_API_KEY=... RENDER_SERVICE_ID=srv-... node scripts/render-status.mjs --deploy --commit <sha>
 *
 * Environment:
 *   RENDER_API_KEY        Render API key (never commit it; use a secret store)
 *   RENDER_SERVICE_ID     srv-... id, or a dashboard URL containing it
 *   RENDER_HEALTH_URL     optional: verify the live /api/health commit instead
 *
 * Exit codes: 0 = success/verified, 1 = failed or not verified, 2 = misconfigured.
 */

import {
  commitMatches,
  createRenderClient,
  findDeployForCommit,
  parseServiceId,
  summarizeService,
  TERMINAL_DEPLOY_STATUSES,
  unwrapList,
} from "./render-api.mjs";

const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 15 * 1000;

function readFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function log(message) {
  console.log(`[render] ${message}`);
}

function fail(message, code = 1) {
  console.error(`[render] ${message}`);
  process.exit(code);
}

async function readHealthCommit(healthUrl, timeoutMs = 20_000) {
  try {
    const response = await fetch(healthUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, status: response.status, commit: null };
    const payload = await response.json();
    return { ok: true, status: response.status, commit: typeof payload?.commit === "string" ? payload.commit : null };
  } catch (error) {
    return { ok: false, status: 0, commit: null, error: String(error) };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const argv = process.argv.slice(2);
  const apiKey = process.env.RENDER_API_KEY ?? "";
  const rawServiceId = process.env.RENDER_SERVICE_ID ?? readFlag(argv, "--service") ?? "";
  const serviceId = parseServiceId(rawServiceId);
  const healthUrl = process.env.RENDER_HEALTH_URL ?? readFlag(argv, "--health-url") ?? "";
  const expectedCommit = readFlag(argv, "--commit") ?? process.env.GITHUB_SHA ?? "";
  const shouldWait = hasFlag(argv, "--wait");
  const shouldDeploy = hasFlag(argv, "--deploy");
  const clearCache = hasFlag(argv, "--clear-cache");

  if (!apiKey) {
    fail("RENDER_API_KEY is not set. Create one at https://dashboard.render.com/u/settings?add-api-key and store it as a secret.", 2);
  }
  if (!serviceId) {
    fail("RENDER_SERVICE_ID is not set (expected srv-... or a dashboard URL containing it).", 2);
  }
  if (shouldDeploy && !expectedCommit) {
    fail("--deploy needs a commit: pass --commit <sha> or set GITHUB_SHA.", 2);
  }

  log(`service ${serviceId}${expectedCommit ? ` · commit ${expectedCommit.slice(0, 7)}` : ""}`);

  let client;
  try {
    client = createRenderClient(apiKey);
  } catch (error) {
    fail(String(error), 2);
  }

  try {
    const servicePayload = await client.getService(serviceId);
    const service = summarizeService(servicePayload?.service ?? servicePayload);
    log(`config: repo=${service.repo ?? "?"} branch=${service.branch ?? "?"} autoDeploy=${service.autoDeploy} url=${service.url ?? "?"}`);

    // Default the verification URL to the service's own public URL when the
    // caller did not pass one; that is the same host Render health-checks.
    const resolvedHealthUrl = healthUrl
      || (typeof service.url === "string" && service.url.startsWith("http") ? `${service.url.replace(/\/$/, "")}/api/health` : "");
    if (service.autoDeploy === false) {
      log("warning: autoDeploy is disabled; merges to the tracked branch will not deploy on their own.");
    }
    if (shouldDeploy) {
      const created = await client.createDeploy(serviceId, {
        commitId: expectedCommit,
        ...(clearCache ? { clearCache: "clear" } : {}),
      });
      const deploy = created?.deploy ?? created;
      log(`triggered deploy ${deploy?.id ?? "(unknown id)"} for ${expectedCommit.slice(0, 7)}`);
      if (!shouldWait) {
        console.log(JSON.stringify({ service, triggered: deploy?.id ?? null, status: deploy?.status ?? null }, null, 2));
        return;
      }
    }

    const deadline = Date.now() + DEFAULT_WAIT_TIMEOUT_MS;
    let lastSummary = null;

    for (;;) {
      const deploys = unwrapList(await client.listDeploys(serviceId, { limit: 20 }));
      const match = expectedCommit ? findDeployForCommit(deploys, expectedCommit) : { deploy: deploys[0], isNewest: true };
      const deploy = match?.deploy ?? null;

      if (!deploy) {
        log(expectedCommit
          ? `no deploy yet for ${expectedCommit.slice(0, 7)}; waiting…`
          : "no deploys found for this service.");
        if (!shouldWait || Date.now() > deadline) break;
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const summary = {
        service: service.name,
        deploy: deploy.id,
        status: deploy.status,
        trigger: deploy.trigger,
        commit: deploy.commit?.id ?? null,
        commitMessage: (deploy.commit?.message ?? "").split("\n")[0],
        startedAt: deploy.startedAt ?? null,
        finishedAt: deploy.finishedAt ?? null,
      };
      if (JSON.stringify(summary) !== JSON.stringify(lastSummary)) {
        log(`deploy ${summary.deploy} · ${summary.status} · ${String(summary.commit ?? "").slice(0, 7)} ${summary.commitMessage}`);
        lastSummary = summary;
      }

      if (TERMINAL_DEPLOY_STATUSES.includes(deploy.status)) {
        console.log(JSON.stringify(summary, null, 2));

        if (deploy.status !== "live") {
          fail(`deploy ${deploy.id} finished as ${deploy.status}.`);
        }

        if (resolvedHealthUrl) {
          const health = await readHealthCommit(resolvedHealthUrl);
          const live = permissiveMatch(health.commit, expectedCommit);
          log(`health: ${resolvedHealthUrl} → HTTP ${health.status}${health.commit ? ` commit ${health.commit.slice(0, 7)}` : ""}`);
          if (!health.ok) {
            fail("the live health endpoint is not reachable; the deploy is live but the service is not serving.");
          }
          if (expectedCommit && !live) {
            fail(`the live service still reports ${health.commit ? health.commit.slice(0, 7) : "no commit"} instead of ${expectedCommit.slice(0, 7)}.`);
          }
        }
        log("deploy verified.");
        return;
      }

      if (!shouldWait || Date.now() > deadline) {
        console.log(JSON.stringify(summary, null, 2));
        if (!shouldWait) return;
        fail(`timed out after ${Math.round(DEFAULT_WAIT_TIMEOUT_MS / 60000)} minutes while the deploy was ${deploy.status}.`);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    if (expectedCommit) {
      fail(`no deploy was found for commit ${expectedCommit.slice(0, 7)}.`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

/** Health payload uses a full SHA; compare leniently in either direction. */
function permissiveMatch(actual, expected) {
  if (!expected) return true;
  return commitMatches(actual, expected);
}

await main();
