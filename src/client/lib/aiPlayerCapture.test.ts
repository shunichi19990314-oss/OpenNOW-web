import { describe, expect, it } from "vitest";

import {
  computeFrameSize,
  estimateFrameTokens,
  isFrameWithinLimit,
} from "./aiPlayerCapture";
import {
  AI_PLAYER_FRAME_MAX_BYTES,
  AI_PLAYER_FRAME_MAX_HEIGHT,
  AI_PLAYER_FRAME_MAX_WIDTH,
} from "../../shared/aiPlayer";

/**
 * Frame sizing only — the canvas call itself needs a browser, so the parts that
 * decide cost and correctness are kept pure and tested here.
 */

describe("frame sizing", () => {
  it("fits a 1080p stream inside the capture bounds", () => {
    const size = computeFrameSize({ width: 1920, height: 1080 });
    expect(size).not.toBeNull();
    expect(size!.width).toBeLessThanOrEqual(AI_PLAYER_FRAME_MAX_WIDTH);
    expect(size!.height).toBeLessThanOrEqual(AI_PLAYER_FRAME_MAX_HEIGHT);
  });

  it("preserves aspect ratio", () => {
    const wide = computeFrameSize({ width: 1920, height: 1080 })!;
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
    const tall = computeFrameSize({ width: 1080, height: 1920 })!;
    expect(tall.height / tall.width).toBeCloseTo(16 / 9, 1);
  });

  it("never upscales a small stream", () => {
    // Upscaling would cost tokens without adding detail the game did not send.
    expect(computeFrameSize({ width: 640, height: 360 })).toEqual({ width: 640, height: 360 });
  });

  it("refuses an empty source instead of sending a black frame", () => {
    expect(computeFrameSize({ width: 0, height: 0 })).toBeNull();
    expect(computeFrameSize({ width: Number.NaN, height: 100 })).toBeNull();
  });

  it("keeps both dimensions even for the JPEG encoder", () => {
    const size = computeFrameSize({ width: 1919, height: 1079 })!;
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
  });
});

describe("frame budget", () => {
  it("rejects an oversized data URL rather than truncating it", () => {
    expect(isFrameWithinLimit(`data:image/jpeg;base64,${"A".repeat(10)}`)).toBe(true);
    expect(isFrameWithinLimit(`data:image/jpeg;base64,${"A".repeat(AI_PLAYER_FRAME_MAX_BYTES)}`)).toBe(false);
    expect(isFrameWithinLimit("")).toBe(false);
  });

  it("estimates token cost from the pixel count", () => {
    const small = estimateFrameTokens({ width: 960, height: 540 });
    const large = estimateFrameTokens({ width: 1920, height: 1080 });
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
  });
});
