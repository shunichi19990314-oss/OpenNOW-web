/**
 * Connection-aware bitrate clamping for stream launches.
 *
 * Requesting a 75 Mbps stream over a link that cannot carry it fills router
 * and radio buffers, which shows up in gameplay as periodic frame stalls
 * ("stutter"). Chromium exposes a coarse bandwidth estimate through the
 * Network Information API; when it is available we cap the launch bitrate so
 * the stream leaves headroom on the access link. Firefox/Safari lack the API
 * and keep the user-configured value untouched.
 */

/** Subset of the Network Information API we rely on (Chromium only). */
export interface NetworkConnectionEstimate {
  /** Estimated downlink bandwidth in megabits per second. */
  downlink?: number;
  /** Coarse link class: "slow-2g" | "2g" | "3g" | "4g". */
  effectiveType?: string;
}

/** Never squeeze a playable stream below this just because of a noisy downlink estimate. */
const DOWNLINK_CAP_FLOOR_MBPS = 5;

/** Hard caps for cellular link classes where downlink estimates are unreliable. */
const LINK_CLASS_CAPS_MBPS: Record<string, number> = {
  "slow-2g": 2,
  "2g": 2,
  "3g": 6,
};

/** Fraction of the estimated downlink the stream is allowed to occupy. */
const DOWNLINK_HEADROOM_FACTOR = 0.8;

export function clampBitrateForConnection(
  requestedMbps: number,
  connection: NetworkConnectionEstimate | null | undefined,
): number {
  if (!Number.isFinite(requestedMbps) || requestedMbps <= 0) {
    return requestedMbps;
  }
  if (!connection) {
    return requestedMbps;
  }

  let cap = Number.POSITIVE_INFINITY;

  const downlink = typeof connection.downlink === "number" && Number.isFinite(connection.downlink)
    ? connection.downlink
    : 0;
  if (downlink > 0) {
    cap = Math.min(cap, Math.max(downlink * DOWNLINK_HEADROOM_FACTOR, DOWNLINK_CAP_FLOOR_MBPS));
  }

  const linkClassCap = typeof connection.effectiveType === "string"
    ? LINK_CLASS_CAPS_MBPS[connection.effectiveType]
    : undefined;
  if (linkClassCap !== undefined) {
    cap = Math.min(cap, linkClassCap);
  }

  if (!Number.isFinite(cap) || cap <= 0) {
    return requestedMbps;
  }
  return Math.max(1, Math.min(requestedMbps, Math.round(cap)));
}

export function readNavigatorConnection(): NetworkConnectionEstimate | null {
  if (typeof navigator === "undefined") {
    return null;
  }
  const connection = (navigator as Navigator & { connection?: NetworkConnectionEstimate }).connection;
  return connection && typeof connection === "object" ? connection : null;
}
