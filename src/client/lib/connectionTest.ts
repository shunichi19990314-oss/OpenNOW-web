/**
 * Pre-launch connection test.
 *
 * Runs five independent probes against everything a stream depends on and
 * produces an informational report visitors can act on before queueing:
 *
 *  1. Region latency      — HTTPS round-trip to the selected/best CloudMatch
 *                           region (reuses the same browser pings the region
 *                           dropdown shows).
 *  2. Download throughput — timed fetch of the same-origin /api/speedtest
 *                           body (signed-in visitors only).
 *  3. WebRTC/ICE          — local gathering against a public STUN server to
 *                           prove UDP egress works; TCP-only candidates warn
 *                           that restrictive networks will stutter.
 *  4. Signaling           — real WebSocket handshake against /api/signaling,
 *                           which also catches OPENNOW_ORIGIN misconfigurations
 *                           (upgrade destroyed before handshake) and reports
 *                           "sign-in required" (close code 4401) separately.
 *  5. Codec support       — existing MediaCapabilities/WebRTC codec probe,
 *                           summarized for H264/HEVC/AV1.
 *
 * Results feed a launch recommendation derived from the measured throughput
 * and the device-adaptive defaults, so visitors on small panels or slow links
 * get a one-click sane configuration.
 */

import type { PingResult, StreamRegion } from "@shared/gfn";

import { DEVICE_STREAM_DEFAULTS } from "../webDefaults";
import { clampBitrateForConnection } from "./connectionBitrate";
import { testCodecSupport } from "./codecDiagnostics";

export type ConnectionTestStatus = "pass" | "warn" | "fail" | "unavailable" | "pending";

export interface LatencyTestResult {
  status: ConnectionTestStatus;
  ms: number | null;
  regionName: string | null;
  requiresAuth?: boolean;
  error?: string;
}

export interface ThroughputTestResult {
  status: ConnectionTestStatus;
  mbps: number | null;
  ttfbMs: number | null;
  requiresAuth: boolean;
  error?: string;
}

export interface WebRtcTestResult {
  status: ConnectionTestStatus;
  hasUdp: boolean;
  candidateTypes: string[];
  gatheringMs: number | null;
  error?: string;
}

export interface SignalingTestResult {
  status: ConnectionTestStatus;
  openMs: number | null;
  requiresAuth: boolean;
  error?: string;
}

export interface CodecTestSummary {
  status: ConnectionTestStatus;
  h264: boolean;
  h264Hardware: boolean;
  hevc: boolean;
  av1: boolean;
  error?: string;
}

export interface ConnectionTestRecommendation {
  resolution: string;
  maxBitrateMbps: number;
}

export interface ConnectionTestReport {
  latency: LatencyTestResult | null;
  throughput: ThroughputTestResult | null;
  webrtc: WebRtcTestResult | null;
  signaling: SignalingTestResult | null;
  codec: CodecTestSummary | null;
  recommendation: ConnectionTestRecommendation | null;
}

const SPEED_TEST_BYTES = 6_000_000;
const SPEED_TEST_TIMEOUT_MS = 20_000;
const ICE_GATHERING_TIMEOUT_MS = 5_000;
const SIGNALING_TIMEOUT_MS = 6_000;
const SIGNALING_STABLE_OPEN_MS = 800;
const STUN_URL = "stun:stun.l.google.com:19302";

function latencyStatus(ms: number): ConnectionTestStatus {
  if (ms <= 50) return "pass";
  if (ms <= 100) return "warn";
  return "fail";
}

function throughputStatus(mbps: number): ConnectionTestStatus {
  if (mbps >= 25) return "pass";
  if (mbps >= 10) return "warn";
  return "fail";
}

export async function runLatencyTest(
  regions: readonly StreamRegion[],
  selectedRegionUrl: string | null,
): Promise<LatencyTestResult> {
  if (regions.length === 0) {
    // The region list comes from an authenticated CloudMatch serverInfo call.
    return { status: "unavailable", ms: null, regionName: null, requiresAuth: true };
  }

  try {
    const results: PingResult[] = await window.openNow.pingRegions([...regions]);
    const entries = regions.map((region, index) => ({ region, result: results[index] }));

    let chosen = selectedRegionUrl
      ? entries.find((entry) => entry.region.url === selectedRegionUrl)
      : undefined;
    if (!chosen || typeof chosen.result?.pingMs !== "number") {
      chosen = entries
        .filter((entry) => typeof entry.result?.pingMs === "number")
        .sort((a, b) => (a.result?.pingMs ?? Infinity) - (b.result?.pingMs ?? Infinity))[0];
    }

    const ms = typeof chosen?.result?.pingMs === "number" ? chosen.result.pingMs : null;
    if (ms === null || !chosen) {
      return {
        status: "unavailable",
        ms: null,
        regionName: null,
        error: entries.find((entry) => entry.result?.error)?.result?.error,
      };
    }
    return { status: latencyStatus(ms), ms, regionName: chosen.region.name };
  } catch (error) {
    return { status: "unavailable", ms: null, regionName: null, error: String(error) };
  }
}

export async function runThroughputTest(): Promise<ThroughputTestResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SPEED_TEST_TIMEOUT_MS);
  try {
    const started = performance.now();
    const response = await fetch(`/api/speedtest?bytes=${SPEED_TEST_BYTES}&cb=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return { status: "unavailable", mbps: null, ttfbMs: null, requiresAuth: true };
    }
    if (!response.ok || !response.body) {
      return { status: "fail", mbps: null, ttfbMs: null, requiresAuth: false, error: `HTTP ${response.status}` };
    }

    const ttfbMs = Math.round(performance.now() - started);
    const reader = response.body.getReader();
    let bytes = 0;
    let firstByteMs: number | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstByteMs === null) firstByteMs = performance.now();
      bytes += value?.byteLength ?? 0;
    }
    const endMs = performance.now();
    const elapsedSeconds = Math.max((endMs - (firstByteMs ?? endMs)) / 1000, 0.05);
    const mbps = (bytes * 8) / elapsedSeconds / 1_000_000;
    return { status: throughputStatus(mbps), mbps, ttfbMs, requiresAuth: false };
  } catch (error) {
    return { status: "fail", mbps: null, ttfbMs: null, requiresAuth: false, error: String(error) };
  } finally {
    window.clearTimeout(timer);
  }
}

export function runWebRtcTest(): Promise<WebRtcTestResult> {
  if (typeof RTCPeerConnection === "undefined") {
    return Promise.resolve({
      status: "unavailable",
      hasUdp: false,
      candidateTypes: [],
      gatheringMs: null,
      error: "WebRTC unavailable",
    });
  }

  return new Promise<WebRtcTestResult>((resolve) => {
    const started = performance.now();
    const candidateTypes = new Set<string>();
    let hasUdp = false;
    let settled = false;
    let pc: RTCPeerConnection | null = null;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        pc?.close();
      } catch {
        // Closing an already-closed peer connection must not fail the report.
      }
      const types = [...candidateTypes];
      const status: ConnectionTestStatus = types.length === 0
        ? "fail"
        : hasUdp
          ? "pass"
          : "warn";
      resolve({ status, hasUdp, candidateTypes: types, gatheringMs: Math.round(performance.now() - started) });
    };
    const timer = window.setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);

    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URL }] });
      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          finish();
          return;
        }
        const text = event.candidate.candidate;
        const typeMatch = /\btyp\s+(\w+)/.exec(text);
        if (typeMatch?.[1]) candidateTypes.add(typeMatch[1]);
        if (/\budp\b/i.test(text)) hasUdp = true;
      };
      pc.onicegatheringstatechange = () => {
        if (pc?.iceGatheringState === "complete") finish();
      };
      const channel = pc.createDataChannel("connection-test");
      channel.close();
      pc.createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch(() => finish());
    } catch {
      finish();
    }
  });
}

export function runSignalingTest(): Promise<SignalingTestResult> {
  return new Promise<SignalingTestResult>((resolve) => {
    const wsBase = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${wsBase}//${window.location.host}/api/signaling`;
    let settled = false;
    let socket: WebSocket | null = null;
    const started = performance.now();

    const finish = (result: SignalingTestResult): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closing; nothing to do.
      }
      resolve(result);
    };
    const timer = window.setTimeout(
      () => finish({ status: "fail", openMs: null, requiresAuth: false, error: "timeout" }),
      SIGNALING_TIMEOUT_MS,
    );

    try {
      socket = new WebSocket(url);
      socket.onopen = () => {
        const openMs = Math.round(performance.now() - started);
        // The bridge closes unauthenticated sockets with 4401 right after the
        // handshake; wait briefly to tell "reachable, needs sign-in" from a
        // healthy authenticated connection.
        window.setTimeout(
          () => finish({ status: "pass", openMs, requiresAuth: false }),
          SIGNALING_STABLE_OPEN_MS,
        );
      };
      socket.onclose = (event) => {
        if (event.code === 4401) {
          finish({ status: "warn", openMs: null, requiresAuth: true });
        } else {
          finish({ status: "fail", openMs: null, requiresAuth: false, error: `close ${event.code}` });
        }
      };
      socket.onerror = () => {
        // onclose follows; only fail early if the socket never opened (e.g.
        // the upgrade was destroyed by an origin mismatch).
      };
    } catch (error) {
      finish({ status: "fail", openMs: null, requiresAuth: false, error: String(error) });
    }
  });
}

export async function runCodecSummaryTest(): Promise<CodecTestSummary> {
  try {
    const results = await testCodecSupport();
    const find = (name: string) => results.find((entry) => entry.codec.toLowerCase() === name);
    const usable = (entry?: { webrtcSupported: boolean; decodeSupported: boolean }) =>
      Boolean(entry?.webrtcSupported && entry?.decodeSupported);
    const h264Entry = find("h264");
    const h264 = usable(h264Entry);
    const h264Hardware = Boolean(h264Entry?.hwAccelerated);
    const status: ConnectionTestStatus = !h264
      ? "fail"
      : h264Hardware
        ? "pass"
        : "warn";
    return {
      status,
      h264,
      h264Hardware,
      hevc: usable(find("hevc")),
      av1: usable(find("av1")),
    };
  } catch (error) {
    return { status: "unavailable", h264: false, h264Hardware: false, hevc: false, av1: false, error: String(error) };
  }
}

export interface ConnectionTestOptions {
  regions: readonly StreamRegion[];
  selectedRegionUrl: string | null;
  onProgress?: (report: ConnectionTestReport) => void;
}

export async function runConnectionTest(options: ConnectionTestOptions): Promise<ConnectionTestReport> {
  const report: ConnectionTestReport = {
    latency: null,
    throughput: null,
    webrtc: null,
    signaling: null,
    codec: null,
    recommendation: null,
  };
  const emit = (): void => {
    options.onProgress?.({ ...report });
  };

  report.latency = await runLatencyTest(options.regions, options.selectedRegionUrl);
  emit();
  report.throughput = await runThroughputTest();
  emit();
  report.webrtc = await runWebRtcTest();
  emit();
  report.signaling = await runSignalingTest();
  emit();
  report.codec = await runCodecSummaryTest();
  emit();

  const mbps = report.throughput?.mbps;
  if (typeof mbps === "number" && mbps > 0) {
    report.recommendation = {
      resolution: DEVICE_STREAM_DEFAULTS.resolution,
      maxBitrateMbps: clampBitrateForConnection(DEVICE_STREAM_DEFAULTS.maxBitrateMbps, { downlink: mbps }),
    };
    emit();
  }

  return report;
}
