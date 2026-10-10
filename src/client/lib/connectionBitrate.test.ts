import { describe, expect, it } from "vitest";

import { clampBitrateForConnection, readNavigatorConnection } from "./connectionBitrate";

describe("clampBitrateForConnection", () => {
  it("returns the requested bitrate when no estimate exists", () => {
    expect(clampBitrateForConnection(75, null)).toBe(75);
    expect(clampBitrateForConnection(75, undefined)).toBe(75);
    expect(clampBitrateForConnection(75, {})).toBe(75);
  });

  it("leaves sane requests untouched on fast links", () => {
    expect(clampBitrateForConnection(40, { downlink: 100, effectiveType: "4g" })).toBe(40);
    expect(clampBitrateForConnection(75, { downlink: 200, effectiveType: "4g" })).toBe(75);
  });

  it("keeps 20% headroom on slower links", () => {
    expect(clampBitrateForConnection(75, { downlink: 50, effectiveType: "4g" })).toBe(40);
    expect(clampBitrateForConnection(75, { downlink: 25, effectiveType: "4g" })).toBe(20);
    expect(clampBitrateForConnection(75, { downlink: 12.5, effectiveType: "4g" })).toBe(10);
  });

  it("never clamps below the playable floor from a noisy estimate alone", () => {
    expect(clampBitrateForConnection(75, { downlink: 2, effectiveType: "4g" })).toBe(5);
    expect(clampBitrateForConnection(3, { downlink: 1, effectiveType: "4g" })).toBe(3);
  });

  it("applies hard caps for cellular link classes", () => {
    expect(clampBitrateForConnection(75, { effectiveType: "3g" })).toBe(6);
    expect(clampBitrateForConnection(75, { effectiveType: "2g" })).toBe(2);
    expect(clampBitrateForConnection(75, { effectiveType: "slow-2g" })).toBe(2);
    expect(clampBitrateForConnection(75, { downlink: 50, effectiveType: "3g" })).toBe(6);
  });

  it("ignores unusable estimates and requests", () => {
    expect(clampBitrateForConnection(75, { downlink: 0, effectiveType: "4g" })).toBe(75);
    expect(clampBitrateForConnection(75, { downlink: Number.NaN })).toBe(75);
    expect(clampBitrateForConnection(0, { downlink: 50 })).toBe(0);
    expect(clampBitrateForConnection(Number.NaN, { downlink: 50 })).toBe(Number.NaN);
  });

  it("reads navigator.connection when the platform exposes it", () => {
    const connection = readNavigatorConnection();
    expect(connection === null || typeof connection === "object").toBe(true);
  });
});
