import type { StreamLagReason } from "../platforms/gfn/webrtcClient";

/**
 * Locale key for a lag reason.
 *
 * The stats overlay used to print the raw enum (`network`, `input_backpressure`)
 * next to the warning triangle; the key table is shared so the compact overlay
 * and the expanded HUD can never drift apart.
 */
export function getLagReasonKey(reason: StreamLagReason): string {
  switch (reason) {
    case "network":
      return "stream.stats.lagReasons.network";
    case "decoder":
      return "stream.stats.lagReasons.decode";
    case "input_backpressure":
      return "stream.stats.lagReasons.input";
    case "render":
      return "stream.stats.lagReasons.render";
    case "stable":
      return "stream.stats.lagReasons.stable";
    default:
      return "stream.stats.lagReasons.unknown";
  }
}

export function getLagReasonLabel(reason: StreamLagReason, t: (key: string) => string): string {
  return t(getLagReasonKey(reason));
}
