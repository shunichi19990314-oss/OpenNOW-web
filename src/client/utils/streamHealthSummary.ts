import type { StreamDiagnostics } from "../platforms/gfn/webrtcClient";

export type StreamHealthTier = "good" | "fair" | "poor" | "connecting";

export interface StreamHealthSummary {
  /** Short label for UI chips */
  label: string;
  tier: StreamHealthTier;
}

function tierFromRttLoss(rttMs: number, packetLossPercent: number): StreamHealthTier {
  if (rttMs <= 0 && packetLossPercent <= 0) return "connecting";
  if (packetLossPercent >= 3 || rttMs >= 90) return "poor";
  if (packetLossPercent >= 1 || rttMs >= 60) return "fair";
  if (rttMs >= 30 || packetLossPercent > 0.15) return "fair";
  return "good";
}

/**
 * Compact stream quality summary for in-stream menu chip (aligned loosely with StatsOverlay RTT bands).
 */
export function getStreamHealthSummary(d: StreamDiagnostics): StreamHealthSummary {
  const lag = d.lagReason;
  if (lag === "decoder" || lag === "input_backpressure") {
    return { label: "ローカル負荷", tier: "fair" };
  }
  if (lag === "network") {
    return { label: "ネットワーク", tier: "poor" };
  }

  const hasVideo = Boolean(d.resolution && d.resolution.length > 0);
  if (!hasVideo && d.rttMs <= 0) {
    return { label: "接続中…", tier: "connecting" };
  }

  const tier = tierFromRttLoss(d.rttMs, d.packetLossPercent);
  const labels: Record<StreamHealthTier, string> = {
    good: "良好",
    fair: "普通",
    poor: "不良",
    connecting: "接続中…",
  };
  return { label: labels[tier], tier };
}
