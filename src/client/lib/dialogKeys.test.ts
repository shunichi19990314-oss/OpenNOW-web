import { describe, expect, it } from "vitest";

import { nextGridIndex, readGridColumns } from "./dialogKeys";

/**
 * Arrow-key navigation runs without a DOM, so the index maths is tested
 * directly. The bug this guards against is wrapping: holding ArrowRight on the
 * last card of a 300-game catalog must not teleport to the first one, and
 * ArrowUp on the top row must not jump to the bottom.
 */

describe("nextGridIndex", () => {
  it("moves one card left and right", () => {
    expect(nextGridIndex(3, "ArrowRight", 10, 4)).toBe(4);
    expect(nextGridIndex(3, "ArrowLeft", 10, 4)).toBe(2);
  });

  it("moves a whole row up and down", () => {
    expect(nextGridIndex(4, "ArrowDown", 20, 4)).toBe(8);
    expect(nextGridIndex(8, "ArrowUp", 20, 4)).toBe(4);
  });

  it("stays put at the edges instead of wrapping", () => {
    expect(nextGridIndex(0, "ArrowLeft", 10, 4)).toBeNull();
    expect(nextGridIndex(9, "ArrowRight", 10, 4)).toBeNull();
    expect(nextGridIndex(1, "ArrowUp", 10, 4)).toBeNull();
    // 2 + 4 = 6 would leave a 6-card list.
    expect(nextGridIndex(2, "ArrowDown", 6, 4)).toBeNull();
  });

  it("keeps a partial last row reachable from the row above", () => {
    // 10 cards, 4 columns: from index 4 Down reaches 8, which exists.
    expect(nextGridIndex(4, "ArrowDown", 10, 4)).toBe(8);
  });

  it("clamps a stale selection back into the list", () => {
    // The selection can point past the end after a filter/search shrinks the
    // grid; the next press should land on a real card.
    expect(nextGridIndex(99, "ArrowLeft", 5, 4)).toBe(3);
  });

  it("handles an empty grid and a degenerate column count", () => {
    expect(nextGridIndex(0, "ArrowRight", 0, 4)).toBeNull();
    expect(nextGridIndex(0, "ArrowDown", 10, 0)).toBe(1);
  });
});

describe("readGridColumns", () => {
  it("counts the resolved tracks", () => {
    const element = { nodeType: 1 } as unknown as Element;
    const original = globalThis.window;
    // getComputedStyle is not available in the node test environment; provide
    // just enough of it for the parser.
    (globalThis as unknown as { window: unknown }).window = {
      getComputedStyle: () => ({ gridTemplateColumns: "248px 248px 248px" }),
    };
    try {
      expect(readGridColumns(element)).toBe(3);
    } finally {
      (globalThis as unknown as { window: unknown }).window = original;
    }
  });

  it("falls back when there is no element or no grid", () => {
    expect(readGridColumns(null, 2)).toBe(2);
  });
});
