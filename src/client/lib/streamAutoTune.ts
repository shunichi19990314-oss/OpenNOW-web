import type { ColorQuality, StreamRegion, VideoCodec, VideoCodecPreference } from "@shared/gfn";

import type { NetworkConnectionEstimate } from "./connectionBitrate";
import { getAutomaticMaxBitrateMbps as automaticCeiling } from "../webDefaults";
import type { CodecTestSummary, LatencyTestResult, ThroughputTestResult, WebRtcTestResult } from "./connectionTest";

/**
 * Automatic stream quality tuning.
 *
 * The settings screen already measures latency, throughput, WebRTC candidates
 * and codec support, but the measurement only ever produced a
 * resolution/bitrate pair. This module turns the same numbers into a full,
 * explainable profile (resolution + fps + bitrate + codec + color quality) and
 * reports exactly which values would change, so the UI can show a review step
 * instead of silently rewriting the visitor's preferences.
 */

export type ConnectionQualityGrade = "excellent" | "good" | "fair" | "weak" | "poor" | "unknown";
export type ConnectionLimitingFactor = "none" | "latency" | "throughput" | "network" | "unknown";

export interface ConnectionQualitySummary {
  grade: ConnectionQualityGrade;
  /** 0-100; the weakest measured link component dominates. */
  score: number;
  limitingFactor: ConnectionLimitingFactor;
  latencyMs: number | null;
  throughputMbps: number | null;
  packetLossPct: number | null;
  udpAvailable: boolean;
}

export interface ConnectionQualityInput {
  latency: Pick<LatencyTestResult, "status" | "ms" | "regionName"> | null;
  throughput: Pick<ThroughputTestResult, "status" | "mbps" | "ttfbMs" | "requiresAuth"> | null;
  webrtc: Pick<WebRtcTestResult, "status" | "hasUdp" | "hasServerReflexive" | "candidateTypes" | "gatheringMs"> | null;
  packetLossPct?: number | null;
}

export interface TuningDeviceProbe {
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  hardwareConcurrency: number;
}

export type TuningCodecSupport = Pick<CodecTestSummary, "h264" | "h264Hardware" | "hevc" | "av1">;

export interface TuningCurrentSettings {
  resolution: string;
  fps: number;
  maxBitrateMbps: number;
  codec: VideoCodecPreference;
  colorQuality: ColorQuality;
}

export interface TuningRecommendedSettings {
  resolution: string;
  fps: number;
  maxBitrateMbps: number;
  codec: VideoCodec;
  colorQuality: ColorQuality;
}

export type TuningChangeKey = "resolution" | "fps" | "maxBitrateMbps" | "codec" | "colorQuality";

export interface TuningChange {
  key: TuningChangeKey;
  from: string | number;
  to: string | number;
}

export interface StreamTuningPlan {
  recommended: TuningRecommendedSettings;
  changes: TuningChange[];
  quality: ConnectionQualitySummary;
}

const THROUGHPUT_WEIGHT = 45;
const LATENCY_WEIGHT = 35;
const NETWORK_WEIGHT = 20;

/** Fraction of the measured downlink the stream may occupy. Mirrors connectionBitrate. */
const THROUGHPUT_HEADROOM = 0.7;
const MIN_RECOMMENDED_BITRATE = 5;
const MAX_RECOMMENDED_BITRATE = 150;

function throughputPoints(mbps: number): number {
  if (mbps >= 80) return THROUGHPUT_WEIGHT;
  if (mbps >= 40) return 38;
  if (mbps >= 25) return 32;
  if (mbps >= 15) return 22;
  if (mbps >= 10) return 15;
  if (mbps >= 5) return 8;
  return 3;
}

function latencyPoints(ms: number): number {
  if (ms <= 20) return LATENCY_WEIGHT;
  if (ms <= 40) return 31;
  if (ms <= 60) return 26;
  if (ms <= 80) return 20;
  if (ms <= 120) return 12;
  if (ms <= 180) return 6;
  return 2;
}

function networkPoints(webrtc: ConnectionQualityInput["webrtc"]): number {
  if (!webrtc) return 10;
  if (webrtc.hasUdp && webrtc.hasServerReflexive) return NETWORK_WEIGHT;
  if (webrtc.hasUdp) return 14;
  if (webrtc.candidateTypes.length === 0) return 2;
  return 6;
}

function bestRegionLatency(regions: readonly StreamRegion[]): number | null {
  const pings = regions
    .map((region) => region.pingMs)
    .filter((ping): ping is number => typeof ping === "number" && Number.isFinite(ping));
  if (pings.length === 0) return null;
  return Math.min(...pings);
}

function gradeForScore(score: number): ConnectionQualityGrade {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  if (score >= 25) return "weak";
  return "poor";
}

/**
 * Collapse the raw probes into one graded verdict.
 *
 * The verdict is bottleneck-weighted: a single failing component (a 6 Mbps
 * link, or a 180 ms route) must not be averaged away by two healthy ones,
 * because gameplay quality follows the weakest link.
 */
export function summarizeConnectionQuality(
  input: ConnectionQualityInput,
  regions: readonly StreamRegion[] = [],
): ConnectionQualitySummary {
  const throughputMbps = typeof input.throughput?.mbps === "number" && Number.isFinite(input.throughput.mbps)
    ? input.throughput.mbps
    : null;
  const latencyMs = typeof input.latency?.ms === "number" && Number.isFinite(input.latency.ms)
    ? input.latency.ms
    : bestRegionLatency(regions);
  const packetLossPct = typeof input.packetLossPct === "number" && Number.isFinite(input.packetLossPct)
    ? Math.max(0, input.packetLossPct)
    : null;
  const udpAvailable = Boolean(input.webrtc?.hasUdp);

  if (throughputMbps === null && latencyMs === null && !input.webrtc) {
    return {
      grade: "unknown",
      score: 0,
      limitingFactor: "unknown",
      latencyMs: null,
      throughputMbps: null,
      packetLossPct,
      udpAvailable: false,
    };
  }

  const ratios: Array<{ factor: ConnectionLimitingFactor; ratio: number }> = [];
  if (throughputMbps !== null) {
    ratios.push({ factor: "throughput", ratio: throughputPoints(throughputMbps) / THROUGHPUT_WEIGHT });
  }
  if (latencyMs !== null) {
    ratios.push({ factor: "latency", ratio: latencyPoints(latencyMs) / LATENCY_WEIGHT });
  }
  if (input.webrtc) {
    ratios.push({ factor: "network", ratio: networkPoints(input.webrtc) / NETWORK_WEIGHT });
  }

  const weakest = ratios.reduce((low, current) => (current.ratio < low.ratio ? current : low), ratios[0]);
  const average = ratios.reduce((sum, entry) => sum + entry.ratio, 0) / ratios.length;
  // 60/40 blend of worst link and overall health: the bottleneck dominates, but
  // one mediocre probe alone cannot sink an otherwise healthy connection.
  const score = Math.max(0, Math.min(100, Math.round((weakest.ratio * 0.6 + average * 0.4) * 100)));

  return {
    grade: gradeForScore(score),
    score,
    limitingFactor: weakest.ratio >= 0.75 ? "none" : weakest.factor,
    latencyMs,
    throughputMbps,
    packetLossPct,
    udpAvailable,
  };
}

function parseResolutionSize(value: string): { width: number; height: number } | null {
  const [rawWidth, rawHeight] = value.split("x");
  const width = Number.parseInt(rawWidth ?? "", 10);
  const height = Number.parseInt(rawHeight ?? "", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function fitsPanel(width: number, height: number, panelLong: number, panelShort: number): boolean {
  return Math.max(width, height) <= panelLong && Math.min(width, height) <= panelShort;
}

function pickCodec(support: TuningCodecSupport): VideoCodec {
  // HEVC first: it is the best-supported hardware decode path on GeForce NOW
  // and needs less bandwidth than H.264 for the same picture. AV1 only when
  // HEVC is unavailable, H.264 as the compatibility floor.
  if (support.hevc) return "H265";
  if (support.av1) return "AV1";
  return "H264";
}

function compatibleColorQuality(codec: VideoCodec, requested: ColorQuality): ColorQuality {
  if (codec === "H264") return "8bit_420";
  return requested;
}

function safeBitrateBudgetMbps(quality: ConnectionQualitySummary, connection: NetworkConnectionEstimate | null): number {
  const candidates: number[] = [];
  if (quality.throughputMbps !== null) {
    candidates.push(quality.throughputMbps * THROUGHPUT_HEADROOM);
  }
  if (typeof connection?.downlink === "number" && connection.downlink > 0) {
    candidates.push(connection.downlink * THROUGHPUT_HEADROOM);
  }
  if (candidates.length === 0) return MAX_RECOMMENDED_BITRATE;
  return Math.max(MIN_RECOMMENDED_BITRATE, Math.min(...candidates));
}

function chooseResolution(
  device: TuningDeviceProbe,
  quality: ConnectionQualitySummary,
): string {
  const dpr = device.devicePixelRatio > 0 ? device.devicePixelRatio : 1;
  const panelLong = Math.max(device.screenWidth, device.screenHeight) * dpr;
  const panelShort = Math.min(device.screenWidth, device.screenHeight) * dpr;
  const lowPowerCpu = device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 4;

  // Start from the panel-appropriate ceiling, then step down for weak links.
  let target = panelLong > 0 && panelLong <= 1600 && panelShort <= 900 ? "1280x720" : "1920x1080";
  if (lowPowerCpu && target === "1920x1080" && quality.throughputMbps !== null && quality.throughputMbps < 30) {
    target = "1280x720";
  }

  const mbps = quality.throughputMbps;
  if (mbps !== null) {
    if (mbps < 25) target = "1280x720";
    // 4K only when the panel can show it *and* the link has real headroom.
    if (panelLong >= 3840 && mbps >= 120 && quality.grade === "excellent") {
      target = "3840x2160";
    }
  }

  const size = parseResolutionSize(target);
  if (size !== null && panelLong > 0 && panelShort > 0 && !fitsPanel(size.width, size.height, panelLong, panelShort)) {
    return "1280x720";
  }
  return target;
}

function chooseFps(quality: ConnectionQualitySummary, device: TuningDeviceProbe, resolution: string): number {
  const size = parseResolutionSize(resolution);
  const pixels = size ? size.width * size.height : 1920 * 1080;
  const lowPowerCpu = device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 4;

  if (quality.grade === "poor" || quality.grade === "unknown") return 30;
  if (quality.grade === "weak") return 30;
  const mbps = quality.throughputMbps;
  if (mbps !== null && mbps < 15 && pixels >= 1920 * 1080) return 30;
  if (lowPowerCpu && pixels > 1920 * 1080) return 30;
  return 60;
}

export interface BuildStreamTuningPlanInput {
  device: TuningDeviceProbe;
  quality: ConnectionQualitySummary;
  codec: TuningCodecSupport;
  current: TuningCurrentSettings;
  /** Optional Network Information API estimate, used as a second opinion. */
  connection?: NetworkConnectionEstimate | null;
}

export function buildStreamTuningPlan(input: BuildStreamTuningPlanInput): StreamTuningPlan {
  const { device, quality, codec, current } = input;
  const connection = input.connection ?? null;

  const resolution = chooseResolution(device, quality);
  const fps = chooseFps(quality, device, resolution);
  const codecChoice = pickCodec(codec);
  const colorQuality = compatibleColorQuality(codecChoice, current.colorQuality);

  const safeBudget = safeBitrateBudgetMbps(quality, connection);
  // Only ever lower a bitrate that the link cannot carry. The automatic ceiling
  // (`getAutomaticMaxBitrateMbps`) is a suggestion for Auto mode, so it must not
  // override an explicit, higher preference on a link that can sustain it.
  const maxBitrateMbps = current.maxBitrateMbps <= 0
    ? 0
    : current.maxBitrateMbps > safeBudget
      ? Math.max(MIN_RECOMMENDED_BITRATE, Math.min(MAX_RECOMMENDED_BITRATE, Math.round(safeBudget)))
      : current.maxBitrateMbps;

  const recommended: TuningRecommendedSettings = {
    resolution,
    fps,
    maxBitrateMbps,
    codec: codecChoice,
    colorQuality,
  };

  const changes: TuningChange[] = [];
  if (current.resolution !== recommended.resolution) {
    changes.push({ key: "resolution", from: current.resolution, to: recommended.resolution });
  }
  if (current.fps !== recommended.fps) {
    changes.push({ key: "fps", from: current.fps, to: recommended.fps });
  }
  if (current.maxBitrateMbps !== recommended.maxBitrateMbps) {
    changes.push({ key: "maxBitrateMbps", from: current.maxBitrateMbps, to: recommended.maxBitrateMbps });
  }
  if (current.codec !== recommended.codec) {
    changes.push({ key: "codec", from: current.codec, to: recommended.codec });
  }
  if (current.colorQuality !== recommended.colorQuality) {
    changes.push({ key: "colorQuality", from: current.colorQuality, to: recommended.colorQuality });
  }

  return { recommended, changes, quality };
}

/**
 * Highest bitrate the automatic ceiling allows for a profile, clamped to the
 * global tuning bounds. Exposed so the UI can show "Auto" equivalents.
 */
export function automaticBitrateCeiling(resolution: string, fps: number): number {
  return Math.max(MIN_RECOMMENDED_BITRATE, Math.min(MAX_RECOMMENDED_BITRATE, Math.round(automaticCeiling(resolution, fps))));
}

/**
 * Human readable one-line summary of a single change, e.g.
 * `1920x1080 → 1280x720`. Pass `t` to use the localized setting label.
 */
export function describeTuningChange(change: TuningChange, t?: (key: string) => string): string {
  const label = t ? t(`streamTuning.fields.${change.key}`) : change.key;
  return `${label}: ${change.from} → ${change.to}`;
}

export function gradeTranslationKey(grade: ConnectionQualityGrade): string {
  return `streamTuning.grade.${grade}`;
}

export function limitingFactorTranslationKey(factor: ConnectionLimitingFactor): string {
  return `streamTuning.limitingFactor.${factor}`;
}
