import { describe, expect, it } from "vitest";

import {
  buildDiagnosticsReport,
  redactHost,
  summarizeUserAgent,
  type DiagnosticsReportInput,
} from "./diagnosticsReport";

const baseInput: DiagnosticsReportInput = {
  appVersion: "0.1.0",
  locale: "ja",
  themePack: "aurora",
  environment: {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    language: "ja-JP",
    hardwareConcurrency: 8,
    screen: { width: 1920, height: 1080, devicePixelRatio: 1.5 },
  },
  stream: {
    resolution: "1920x1080",
    fps: 60,
    codec: "AV1",
    hardwareAcceleration: "GPU (D3D11)",
    bitrateKbps: 39_500,
    targetBitrateKbps: 40_000,
    packetsLost: 12,
    packetLossPercent: 0.42,
    rttMs: 23.4,
    lagReason: "network",
    lagReasonDetail: "ジッター増加",
  },
  session: {
    region: "203.0.113.7",
    startedAtMs: 1_700_000_000_000,
    endedAtMs: 1_700_001_850_000,
    timeToFirstFrameMs: 4_120.6,
  },
  streamSettings: { resolution: "1920x1080", codec: "AUTO", adaptiveBitrate: true },
};

describe("diagnostics report", () => {
  it("includes the useful sections", () => {
    const report = buildDiagnosticsReport(baseInput);
    expect(report).toContain("OpenNOW Web diagnostics");
    expect(report).toContain("[Build]");
    expect(report).toContain("[Browser]");
    expect(report).toContain("[Stream settings]");
    expect(report).toContain("[Stream]");
    expect(report).toContain("[Last session]");
    expect(report).toContain("Codec: AV1");
    expect(report).toContain("Duration: 30m 50s");
    // Support reads the report verbatim; a fixed UTC stamp keeps it unambiguous.
    expect(report).toMatch(/Started: 2023-11-14 22:13:20Z/);
  });

  it("never leaks an address, token or query string", () => {
    const report = buildDiagnosticsReport({
      ...baseInput,
      session: { ...baseInput.session, region: "203.0.113.7" },
      streamSettings: { sessionProxyUrl: "https://proxy.example/stream?token=abcdef&x=1" },
    });
    expect(report).not.toContain("203.0.113.7");
    expect(report).not.toContain("abcdef");
    expect(report).toContain("token=[redacted]");
    expect(report).toContain("Region: [redacted]");
  });

  it("summarizes the user agent to engine + major version", () => {
    expect(summarizeUserAgent(baseInput.environment.userAgent))
      .toBe("Chrome 129 · AppleWebKit 537");
    expect(summarizeUserAgent("")).toBe("[redacted]");
  });

  it("redacts bare IPv4 and IPv6 hosts but keeps region names", () => {
    expect(redactHost("192.168.1.4")).toBe("[redacted]");
    expect(redactHost("2001:db8::1")).toBe("[redacted]");
    expect(redactHost("EU West")).toBe("EU West");
    expect(redactHost(undefined)).toBe("-");
  });

  it("omits sections with no data instead of printing empty headings", () => {
    const report = buildDiagnosticsReport({
      appVersion: "0.1.0",
      locale: "ja",
      environment: { userAgent: "", language: "ja-JP" },
    });
    expect(report).not.toContain("[Stream]");
    expect(report).not.toContain("[Last session]");
    expect(report).not.toContain("[Stream settings]");
  });
});
