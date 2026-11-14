import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatPlaytime } from "./usePlaytime";

/**
 * `formatPlaytime` is the label the Continue-playing rail and the library rows
 * show, so the boundaries matter: a 59-minute session must not read "1 h".
 */
describe("formatPlaytime", () => {
  it("labels a missing playtime instead of showing 0 m", () => {
    expect(formatPlaytime(0)).toBe("Never played");
    expect(formatPlaytime(-30)).toBe("Never played");
  });

  it("keeps sub-hour values in minutes", () => {
    expect(formatPlaytime(1)).toBe("< 1 min");
    expect(formatPlaytime(59)).toBe("< 1 min");
    expect(formatPlaytime(60)).toBe("1 m");
    expect(formatPlaytime(59 * 60)).toBe("59 m");
  });

  it("switches to hours at the hour boundary", () => {
    expect(formatPlaytime(60 * 60)).toBe("1 h");
    expect(formatPlaytime(60 * 60 + 60)).toBe("1 h 1 m");
    expect(formatPlaytime(125 * 60)).toBe("2 h 5 m");
  });

  it("ignores fractional and non-finite input", () => {
    expect(formatPlaytime(Number.NaN)).toBe("Never played");
    expect(formatPlaytime(Number.POSITIVE_INFINITY)).toBe("Never played");
    expect(formatPlaytime(90.7)).toBe("1 m");
  });
});
