import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for two reported details-modal defects:
 *
 *  1. the first lines of the description were covered by the hero area, and
 *  2. the action row and the note underneath it were glued together.
 *
 * Both were CSS-only, so neither shows up in a render test — these assertions
 * read the stylesheet and check the specific declarations that fix them.
 */

const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

/** All bodies for a selector, in file order. */
function bodies(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))]
    .map((match) => match[2]);
}

function lastBody(selector: string): string {
  const all = bodies(selector);
  expect(all.length).toBeGreaterThan(0);
  return all[all.length - 1];
}

describe("details modal hero box", () => {
  it("gives the hero an explicit height instead of deriving it from its width", () => {
    const hero = lastBody(".game-details-hero");
    // `aspect-ratio` made the height follow the width, so the art stayed at
    // its intrinsic (narrow) size and only covered part of the modal.
    expect(hero).toContain("height:");
    expect(hero).not.toContain("aspect-ratio");
    expect(hero).toContain("overflow: hidden");
  });

  it("lets the art fill the whole content width", () => {
    // The rule is shared with the placeholder box: `.game-details-hero > img,
    // .game-details-hero-placeholder { … }`.
    const image =
      /\.game-details-hero > img,\s*\.game-details-hero-placeholder\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(image).toContain("width: 100%");
    expect(image).toContain("object-fit: cover");
    // `min-height: 260px` kept the art from shrinking into its box.
    expect(image).toContain("min-height: 0");
  });

  it("uses a modal wide enough for the hero to be a header, not a thumbnail", () => {
    const width = /width:\s*min\((\d+)px,\s*100%\)/.exec(bodies(".game-details-modal")[0])?.[1];
    expect(Number(width)).toBeGreaterThanOrEqual(960);
  });

  it("ends the hero shade gently so the hero edge is not a second dark band", () => {
    const shade = lastBody(".game-details-hero-shade");
    // A gradient that reaches full opacity at 100% draws a hard line on the
    // hero edge; the last stop must be lighter than the one before it.
    const stops = [...shade.matchAll(/rgba\(0,\s*0,\s*0,\s*([\d.]+)\)\s*(\d+)%/g)].map((match) => ({
      alpha: Number(match[1]),
      at: Number(match[2]),
    }));
    expect(stops.length).toBeGreaterThan(2);
    const last = stops[stops.length - 1];
    const previous = stops[stops.length - 2];
    expect(last.at).toBe(100);
    expect(last.alpha).toBeLessThan(previous.alpha);
  });

  it("keeps the content above the hero's stacking context", () => {
    const content = lastBody(".game-details-content");
    expect(content).toContain("position: relative");
    expect(content).toContain("z-index");
  });

  it("keeps the close button above the lifted content layer", () => {
    const close = bodies(".game-details-close").join("\n");
    const zIndexes = [...close.matchAll(/z-index:\s*(\d+)/g)].map((match) => Number(match[1]));
    const contentZ = Number(/z-index:\s*(\d+)/.exec(lastBody(".game-details-content"))?.[1] ?? 0);
    expect(Math.max(...zIndexes)).toBeGreaterThan(contentZ);
  });
});

describe("details modal spacing", () => {
  it("separates the action row from the note below it", () => {
    // The buttons touched the note because the note declared `margin: 0 0 4px`.
    const note = lastBody(".game-details-purchase-note");
    const top = /margin:\s*([^;]+);/.exec(note)?.[1] ?? "";
    expect(top.split(/\s+/)[0]).not.toBe("0");
  });

  it("separates the note from the description that follows it", () => {
    const rule = bodies(".game-details-purchase-note + .game-details-description")[0];
    expect(rule).toContain("margin-top");
  });
});
