import { describe, expect, it } from "vitest";

import type { StreamRegion } from "@shared/gfn";

import { supportedStreamResolutions } from "@shared/gfn";

import {
  buildStreamTuningPlan,
  describeTuningChange,
  summarizeConnectionQuality,
  type TuningDeviceProbe,
} from "./streamAutoTune";

const SUPPORTED_RESOLUTIONS = supportedStreamResolutions();

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

  it("never recommends a mode wider or taller than the panel", () => {
    // 4:3 panel: the old fallback returned 1280x720, which is wider than the
    // glass, so the "tuning" made the stream *not* fit.
    const fourByThree = buildStreamTuningPlan({
      device: { screenWidth: 1024, screenHeight: 768, devicePixelRatio: 1, hardwareConcurrency: 8 },
      quality: { grade: "good", score: 70, limitingFactor: "none", latencyMs: 30, throughputMbps: 60, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: true, hevc: false, av1: false },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 40, codec: "H264", colorQuality: "8bit_420" },
    });
    expect(fourByThree.recommended.resolution).toBe("1024x768");
  });

  it("downgrades a 1680x1050 panel instead of recommending 1080p", () => {
    const plan = buildStreamTuningPlan({
      device: { screenWidth: 1680, screenHeight: 1050, devicePixelRatio: 1, hardwareConcurrency: 8 },
      quality: { grade: "excellent", score: 92, limitingFactor: "none", latencyMs: 20, throughputMbps: 150, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: true, hevc: true, av1: false },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 40, codec: "H265", colorQuality: "8bit_420" },
    });
    // 16:9 is preferred over the larger 1680x1050 16:10 mode, so the framing
    // does not silently change aspect ratio during a downgrade.
    expect(plan.recommended.resolution).toBe("1600x900");
  });

  it("only recommends resolution strings the service accepts", () => {
    for (const probe of [
      { screenWidth: 1024, screenHeight: 768, devicePixelRatio: 1, hardwareConcurrency: 8 },
      { screenWidth: 1112, screenHeight: 834, devicePixelRatio: 2, hardwareConcurrency: 4 },
      { screenWidth: 1366, screenHeight: 768, devicePixelRatio: 1, hardwareConcurrency: 2 },
      { screenWidth: 1920, screenHeight: 1080, devicePixelRatio: 2, hardwareConcurrency: 16 },
    ]) {
      const plan = buildStreamTuningPlan({
        device: probe,
        quality: { grade: "good", score: 65, limitingFactor: "none", latencyMs: 35, throughputMbps: 50, packetLossPct: null, udpAvailable: true },
        codec: { h264: true, h264Hardware: true, hevc: true, av1: true },
        current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 40, codec: "H265", colorQuality: "8bit_420" },
      });
      expect(SUPPORTED_RESOLUTIONS).toContain(plan.recommended.resolution);
    }
  });

  it("does not ask for 60 fps on a link that cannot carry 1080p60", () => {
    // 25 Mbps is below the 40 Mbps the encoder needs for 1080p60, so a "good"
    // grade must still settle on 30 fps rather than trading frame pacing for a
    // frame counter.
    const plan = buildStreamTuningPlan({
      device: probe,
      quality: { grade: "good", score: 66, limitingFactor: "none", latencyMs: 40, throughputMbps: 25, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: true, hevc: true, av1: false },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 40, codec: "H265", colorQuality: "8bit_420" },
    });
    expect(plan.recommended.fps).toBe(30);
  });

  it("keeps 60 fps when the link has the headroom", () => {
    const plan = buildStreamTuningPlan({
      device: probe,
      quality: { grade: "excellent", score: 90, limitingFactor: "none", latencyMs: 20, throughputMbps: 150, packetLossPct: null, udpAvailable: true },
      codec: { h264: true, h264Hardware: true, hevc: true, av1: false },
      current: { resolution: "1920x1080", fps: 60, maxBitrateMbps: 40, codec: "H265", colorQuality: "8bit_420" },
    });
    expect(plan.recommended.fps).toBe(60);
  });
});
