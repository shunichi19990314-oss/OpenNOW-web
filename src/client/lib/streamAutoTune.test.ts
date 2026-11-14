import { describe, expect, it } from "vitest";

import type { StreamRegion } from "@shared/gfn";

import {
  buildStreamTuningPlan,
  describeTuningChange,
  summarizeConnectionQuality,
  type TuningDeviceProbe,
} from "./streamAutoTune";

const probe: TuningDeviceProbe = {
  screenWidth: 1920,
  screenHeight: 1080,
  devicePixelRatio: 1,
  hardwareConcurrency: 8,
};

function region(url: string, pingMs?: number): StreamRegion {
  return { name: url, url, pingMs };
}

describe("summarizeConnectionQuality", () => {
  it("marks a fast, close, UDP link as excellent", () => {
    const quality = summarizeConnectionQuality(
      {
        latency: { status: "pass", ms: 18, regionName: "eu" },
        throughput: { status: "pass", mbps: 120, ttfbMs: 30, requiresAuth: false },
        webrtc: { status: "pass", hasUdp: true, hasServerReflexive: true, candidateTypes: ["host", "srflx", "udp"], gatheringMs: 120 },
      },
      [region("a", 18)],
    );
    expect(quality.grade).toBe("excellent");
    expect(quality.limitingFactor).toBe("none");
    expect(quality.score).toBeGreaterThanOrEqual(80);
  });

  it("blames throughput when the link is slow", () => {
    const quality = summarizeConnectionQuality(
      {
        latency: { status: "pass", ms: 30, regionName: "eu" },
        throughput: { status: "fail", mbps: 6, ttfbMs: 80, requiresAuth: false },
        webrtc: { status: "pass", hasUdp: true, hasServerReflexive: true, candidateTypes: ["udp"], gatheringMs: 90 },
      },
      [region("a", 30)],
    );
    expect(quality.limitingFactor).toBe("throughput");
    expect(["weak", "poor"]).toContain(quality.grade);
  });

  it("blames latency for long round trips", () => {
    const quality = summarizeConnectionQuality(
      {
        latency: { status: "fail", ms: 180, regionName: "us" },
        throughput: { status: "pass", mbps: 90, ttfbMs: 40, requiresAuth: false },
        webrtc: { status: "pass", hasUdp: true, hasServerReflexive: true, candidateTypes: ["udp"], gatheringMs: 100 },
      },
      [region("a", 180)],
    );
    expect(quality.limitingFactor).toBe("latency");
  });

  it("blames the network path when WebRTC falls back to TCP", () => {
    const quality = summarizeConnectionQuality(
      {
        latency: { status: "pass", ms: 22, regionName: "eu" },
        throughput: { status: "pass", mbps: 80, ttfbMs: 40, requiresAuth: false },
        webrtc: { status: "warn", hasUdp: false, hasServerReflexive: false, candidateTypes: ["tcp"], gatheringMs: 90 },
      },
      [region("a", 22)],
    );
    expect(quality.limitingFactor).toBe("network");
    expect(quality.grade).not.toBe("excellent");
  });

  it("degrades gracefully when a probe is missing", () => {
    const quality = summarizeConnectionQuality({ latency: null, throughput: null, webrtc: null }, []);
    expect(quality.grade).toBe("unknown");
    expect(quality.limitingFactor).toBe("unknown");
    expect(quality.throughputMbps).toBeNull();
    expect(quality.latencyMs).toBeNull();
  });
});

describe("buildStreamTuningPlan", () => {
  it("keeps 1080p on a strong link with hardware HEVC", () => {
    const plan = buildStreamTuningPlan({
      device: probe,
      quality: { grade: "excellent", score: 96, limitingFactor: "none", latencyMs: 18, throughputMbps: 200, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: true, hevc: true, av1: true },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 40, codec: "H264", colorQuality: "8bit_420" },
    });
    expect(plan.recommended.resolution).toBe("1920x1080");
    expect(plan.recommended.fps).toBe(60);
    expect(plan.recommended.codec).toBe("H265");
    expect(plan.recommended.maxBitrateMbps).toBeGreaterThanOrEqual(40);
    expect(plan.changes).toEqual(expect.arrayContaining([expect.objectContaining({ key: "codec" })]));
  });

  it("drops to 720p and 30 fps on a weak link", () => {
    const plan = buildStreamTuningPlan({
      device: probe,
      quality: { grade: "poor", score: 22, limitingFactor: "throughput", latencyMs: 90, throughputMbps: 6, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: false, hevc: false, av1: false },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 40, codec: "H264", colorQuality: "8bit_420" },
    });
    expect(plan.recommended.resolution).toBe("1280x720");
    expect(plan.recommended.fps).toBe(30);
    expect(plan.recommended.codec).toBe("H264");
    expect(plan.recommended.maxBitrateMbps).toBeLessThanOrEqual(12);
  });

  it("never recommends a codec the device cannot decode", () => {
    const plan = buildStreamTuningPlan({
      device: probe,
      quality: { grade: "excellent", score: 90, limitingFactor: "none", latencyMs: 20, throughputMbps: 200, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: false, hevc: false, av1: false },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 40, codec: "H264", colorQuality: "8bit_420" },
    });
    expect(plan.recommended.codec).toBe("H264");
    expect(plan.recommended.colorQuality).toBe("8bit_420");
  });

  it("keeps 10-bit color only when a 10-bit codec is available", () => {
    const plan = buildStreamTuningPlan({
      device: probe,
      quality: { grade: "excellent", score: 92, limitingFactor: "none", latencyMs: 20, throughputMbps: 180, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: true, hevc: true, av1: true },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 50, codec: "H265", colorQuality: "10bit_420" },
    });
    expect(plan.recommended.codec).toBe("H265");
    expect(plan.recommended.colorQuality).toBe("10bit_420");
  });

  it("reports no changes when the current settings already match", () => {
    const plan = buildStreamTuningPlan({
      device: probe,
      quality: { grade: "excellent", score: 92, limitingFactor: "none", latencyMs: 20, throughputMbps: 180, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: true, hevc: true, av1: true },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 80, codec: "H265", colorQuality: "8bit_420" },
    });
    expect(plan.changes).toEqual([]);
  });

  it("scales down on a small panel", () => {
    const plan = buildStreamTuningPlan({
      device: { screenWidth: 1366, screenHeight: 768, devicePixelRatio: 1, hardwareConcurrency: 4 },
      quality: { grade: "good", score: 70, limitingFactor: "none", latencyMs: 35, throughputMbps: 60, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: true, hevc: true, av1: false },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 40, codec: "H264", colorQuality: "8bit_420" },
    });
    expect(plan.recommended.resolution).toBe("1280x720");
  });

  it("describes a change with both sides", () => {
    const plan = buildStreamTuningPlan({
      device: probe,
      quality: { grade: "poor", score: 20, limitingFactor: "throughput", latencyMs: 90, throughputMbps: 5, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: false, hevc: false, av1: false },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 40, codec: "H264", colorQuality: "8bit_420" },
    });
    const resolutionChange = plan.changes.find((change) => change.key === "resolution");
    expect(resolutionChange).toBeDefined();
    expect(describeTuningChange(resolutionChange!)).toContain("1920x1080");
    expect(describeTuningChange(resolutionChange!)).toContain("1280x720");
  });
});
