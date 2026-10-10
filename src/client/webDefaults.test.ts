import { describe, expect, it } from "vitest";

import { chooseStreamDefaultsForDevice } from "./webDefaults";

describe("chooseStreamDefaultsForDevice", () => {
  it("matches small low-power panels (ASUS Chromebook CR11 Flip: 1366x768, N150 4-core)", () => {
    expect(
      chooseStreamDefaultsForDevice({
        screenWidth: 1366,
        screenHeight: 768,
        devicePixelRatio: 1,
        hardwareConcurrency: 4,
      }),
    ).toEqual({ resolution: "1280x720", maxBitrateMbps: 20 });
  });

  it("uses 720p for small panels on faster CPUs and for phones/tablets", () => {
    expect(
      chooseStreamDefaultsForDevice({
        screenWidth: 1366,
        screenHeight: 768,
        devicePixelRatio: 1,
        hardwareConcurrency: 8,
      }),
    ).toEqual({ resolution: "1280x720", maxBitrateMbps: 25 });
    // Phone: 393x873 CSS px at dpr 2.75 -> ~1080x2400 physical, long edge > 1600?
    // Long edge exceeds the small-panel bound, so phones keep the desktop default.
    expect(
      chooseStreamDefaultsForDevice({
        screenWidth: 393,
        screenHeight: 873,
        devicePixelRatio: 2.75,
        hardwareConcurrency: 8,
      }),
    ).toEqual({ resolution: "1920x1080", maxBitrateMbps: 40 });
    // Tablet in landscape at moderate dpr stays on the small-panel profile.
    expect(
      chooseStreamDefaultsForDevice({
        screenWidth: 800,
        screenHeight: 1280,
        devicePixelRatio: 1,
        hardwareConcurrency: 8,
      }),
    ).toEqual({ resolution: "1280x720", maxBitrateMbps: 25 });
  });

  it("keeps 1080p with a reduced bitrate for low-power CPUs on large panels", () => {
    // CR12 Flip class: 1920x1200 panel, 4-core N-series.
    expect(
      chooseStreamDefaultsForDevice({
        screenWidth: 1920,
        screenHeight: 1200,
        devicePixelRatio: 1,
        hardwareConcurrency: 4,
      }),
    ).toEqual({ resolution: "1920x1080", maxBitrateMbps: 30 });
  });

  it("keeps full defaults for capable desktops and laptops", () => {
    expect(
      chooseStreamDefaultsForDevice({
        screenWidth: 2560,
        screenHeight: 1440,
        devicePixelRatio: 1,
        hardwareConcurrency: 16,
      }),
    ).toEqual({ resolution: "1920x1080", maxBitrateMbps: 40 });
    // Retina laptop: 1512x982 CSS at dpr 2 -> large physical panel.
    expect(
      chooseStreamDefaultsForDevice({
        screenWidth: 1512,
        screenHeight: 982,
        devicePixelRatio: 2,
        hardwareConcurrency: 10,
      }),
    ).toEqual({ resolution: "1920x1080", maxBitrateMbps: 40 });
  });

  it("falls back to full defaults when probing yields nothing", () => {
    expect(
      chooseStreamDefaultsForDevice({
        screenWidth: 0,
        screenHeight: 0,
        devicePixelRatio: 0,
        hardwareConcurrency: 0,
      }),
    ).toEqual({ resolution: "1920x1080", maxBitrateMbps: 40 });
  });
});
