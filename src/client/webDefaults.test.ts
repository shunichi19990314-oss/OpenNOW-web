import { describe, expect, it } from "vitest";

import { supportedStreamResolutions } from "@shared/gfn";

import { chooseStreamDefaultsForDevice, fitResolutionToDisplay } from "./webDefaults";

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

describe("fitResolutionToDisplay", () => {
  const cr11 = { screenWidth: 1366, screenHeight: 768, devicePixelRatio: 1, hardwareConcurrency: 4 };

  it("downsizes a stale oversized request to the device default on a small panel (CR11 1080p -> 720p)", () => {
    expect(fitResolutionToDisplay("1920x1080", cr11)).toBe("1280x720");
  });

  it("honors a request that already fits the panel (including 1:1 native)", () => {
    expect(fitResolutionToDisplay("1280x720", cr11)).toBe("1280x720");
    expect(fitResolutionToDisplay("1366x768", cr11)).toBe("1366x768");
  });

  it("leaves capable displays untouched when the request fits", () => {
    const desktop = { screenWidth: 2560, screenHeight: 1440, devicePixelRatio: 1, hardwareConcurrency: 16 };
    expect(fitResolutionToDisplay("1920x1080", desktop)).toBe("1920x1080");
    // A 4K request on a 1440p panel is oversized -> device default (1080p).
    expect(fitResolutionToDisplay("3840x2160", desktop)).toBe("1920x1080");
  });

  it("accounts for devicePixelRatio when measuring the panel", () => {
    // Retina laptop: 1512x982 CSS at dpr 2 -> 3024x1964 physical panel.
    const retina = { screenWidth: 1512, screenHeight: 982, devicePixelRatio: 2, hardwareConcurrency: 10 };
    expect(fitResolutionToDisplay("1920x1080", retina)).toBe("1920x1080");
    expect(fitResolutionToDisplay("3840x2160", retina)).toBe("1920x1080");
  });

  it("does not guess when the display probe is unavailable", () => {
    const unknown = { screenWidth: 0, screenHeight: 0, devicePixelRatio: 0, hardwareConcurrency: 0 };
    expect(fitResolutionToDisplay("1920x1080", unknown)).toBe("1920x1080");
  });

  it("passes through unparseable resolutions untouched", () => {
    expect(fitResolutionToDisplay("garbage", cr11)).toBe("garbage");
    expect(fitResolutionToDisplay("", cr11)).toBe("");
  });
});

describe("fitResolutionToDisplay panels the device default does not fit", () => {
  it("steps down to a supported mode on a 1680x1050 panel (not 'small', cannot show 1080p)", () => {
    // longEdge 1680 > 1600 so chooseStreamDefaultsForDevice returns 1920x1080,
    // which is wider than the glass. Handing that back would defeat the fit.
    const panel = { screenWidth: 1680, screenHeight: 1050, devicePixelRatio: 1, hardwareConcurrency: 8 };
    expect(fitResolutionToDisplay("1920x1080", panel)).toBe("1600x900");
  });

  it("steps down on a 4:3 1024x768 panel where 720p is too wide", () => {
    const panel = { screenWidth: 1024, screenHeight: 768, devicePixelRatio: 1, hardwareConcurrency: 8 };
    expect(fitResolutionToDisplay("1920x1080", panel)).toBe("1024x768");
  });

  it("keeps the requested aspect ratio when stepping down (16:10 request stays 16:10)", () => {
    const panel = { screenWidth: 1680, screenHeight: 1050, devicePixelRatio: 1, hardwareConcurrency: 8 };
    expect(fitResolutionToDisplay("1920x1200", panel)).toBe("1680x1050");
  });

  it("leaves the request alone when no supported mode fits the panel", () => {
    // Smallest GFN mode is 1024x768; an 800x600 panel fits none, so do not guess.
    const tiny = { screenWidth: 800, screenHeight: 600, devicePixelRatio: 1, hardwareConcurrency: 4 };
    expect(fitResolutionToDisplay("1920x1080", tiny)).toBe("1920x1080");
  });

  it("accounts for devicePixelRatio when deciding what the panel can show", () => {
    // 1680x1050 CSS at dpr 1.25 -> 2100x1312 physical: 1920x1080 now fits.
    const scaled = { screenWidth: 1680, screenHeight: 1050, devicePixelRatio: 1.25, hardwareConcurrency: 8 };
    expect(fitResolutionToDisplay("1920x1080", scaled)).toBe("1920x1080");
  });

  it("always returns a resolution GeForce NOW supports", () => {
    // Read straight from the entitlement layer: a value outside
    // STREAM_MODE_PRESETS is not matched by resolveEntitledStreamProfile, which
    // rebinds it to the LARGEST entitled mode instead of the intended downgrade.
    const supported = new Set(supportedStreamResolutions());
    expect(supported.has("1920x1080")).toBe(true);
    expect(supported.has("1024x768")).toBe(true);
    const panels = [
      { screenWidth: 1680, screenHeight: 1050, devicePixelRatio: 1, hardwareConcurrency: 8 },
      { screenWidth: 1024, screenHeight: 768, devicePixelRatio: 1, hardwareConcurrency: 4 },
      { screenWidth: 1366, screenHeight: 768, devicePixelRatio: 1, hardwareConcurrency: 4 },
      { screenWidth: 1600, screenHeight: 1200, devicePixelRatio: 1, hardwareConcurrency: 16 },
    ];
    for (const panel of panels) {
      for (const requested of ["3840x2160", "2560x1440", "1920x1080", "1920x1200"]) {
        const result = fitResolutionToDisplay(requested, panel);
        // Either the untouched request or a supported mode, never an invention.
        expect(result === requested || supported.has(result)).toBe(true);
      }
    }
  });

  it("never returns a resolution larger than a panel it claims to fit", () => {
    const panels = [
      { screenWidth: 1680, screenHeight: 1050, devicePixelRatio: 1 },
      { screenWidth: 1024, screenHeight: 768, devicePixelRatio: 1 },
      { screenWidth: 1600, screenHeight: 1200, devicePixelRatio: 1 },
      { screenWidth: 1440, screenHeight: 900, devicePixelRatio: 1 },
    ];
    for (const raw of panels) {
      const panel = { ...raw, hardwareConcurrency: 8 };
      const result = fitResolutionToDisplay("3840x2160", panel);
      if (result === "3840x2160") continue; // nothing fit; request preserved by design
      const [w, h] = result.split("x").map((part) => Number.parseInt(part, 10));
      const long = Math.max(w, h);
      const short = Math.min(w, h);
      const panelLong = Math.max(panel.screenWidth, panel.screenHeight);
      const panelShort = Math.min(panel.screenWidth, panel.screenHeight);
      expect(long).toBeLessThanOrEqual(panelLong);
      expect(short).toBeLessThanOrEqual(panelShort);
    }
  });
});
