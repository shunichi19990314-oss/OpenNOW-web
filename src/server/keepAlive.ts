/**
 * Keep-alive self-ping for platforms that idle-sleep free instances
 * (Render spins down after 15 minutes without inbound HTTP traffic).
 *
 * The server periodically requests its own public health endpoint; the
 * request leaves the instance and comes back as inbound traffic, which
 * resets the platform's idle timer. Once anything (a visitor or the
 * companion GitHub Actions cron) wakes the instance, this keeps it awake.
 *
 * Enable with KEEP_ALIVE=true (uses OPENNOW_ORIGIN) or point
 * KEEP_ALIVE_URL at an explicit endpoint. Off by default so Railway
 * deployments generate no pointless traffic.
 */

export interface KeepAliveConfig {
  enabled: boolean;
  url: string | null;
  intervalMs: number;
}

const DEFAULT_INTERVAL_MINUTES = 10;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 30;
const PING_TIMEOUT_MS = 30_000;

export function resolveKeepAliveConfig(env: NodeJS.ProcessEnv = process.env): KeepAliveConfig {
  const rawFlag = (env.KEEP_ALIVE ?? "").trim().toLowerCase();
  const flagOff = rawFlag === "false" || rawFlag === "0" || rawFlag === "no";
  const flagOn = rawFlag === "true" || rawFlag === "1" || rawFlag === "yes";

  const explicitUrl = (env.KEEP_ALIVE_URL ?? "").trim();
  const origin = (env.OPENNOW_ORIGIN ?? "").trim().replace(/\/+$/, "");

  const url = explicitUrl.length > 0
    ? explicitUrl
    : origin.length > 0
      ? `${origin}/api/health`
      : null;

  const enabled = !flagOff && (flagOn || explicitUrl.length > 0) && url !== null;

  const requestedMinutes = Number.parseFloat(env.KEEP_ALIVE_INTERVAL_MINUTES ?? "");
  const minutes = Number.isFinite(requestedMinutes) && requestedMinutes > 0
    ? Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, requestedMinutes))
    : DEFAULT_INTERVAL_MINUTES;

  return { enabled, url: enabled ? url : null, intervalMs: Math.round(minutes * 60_000) };
}

/** Start the interval; returns a stop function. Safe to call when disabled. */
export function startKeepAlive(
  config: KeepAliveConfig,
  fetchImpl: typeof fetch = fetch,
): () => void {
  if (!config.enabled || !config.url) {
    return () => {};
  }
  const url = config.url;
  let inFlight = false;

  const timer = setInterval(() => {
    if (inFlight) {
      return; // a slow ping must never stack up
    }
    inFlight = true;
    fetchImpl(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) {
          console.warn(`[KeepAlive] Health ping returned HTTP ${response.status}`);
        }
      })
      .catch((error: unknown) => {
        console.warn(`[KeepAlive] Health ping failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        inFlight = false;
      });
  }, config.intervalMs);
  timer.unref?.();

  console.log(`[KeepAlive] Self-pinging ${url} every ${Math.round(config.intervalMs / 60_000)} min`);
  return () => clearInterval(timer);
}
