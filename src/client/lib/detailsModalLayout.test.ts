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
  it("constrains the hero instead of only setting a minimum height", () => {
    const hero = bodies(".game-details-hero").join("\n");
    // A `min-height` alone let the absolutely positioned art overflow and the
    // shade gradient paint over the description's first lines.
    expect(hero).toContain("aspect-ratio");
    expect(hero).toContain("overflow: hidden");
  });

  it("does not force the image taller than its own box", () => {
    const image = bodies(".game-details-hero > img").join("\n");
    expect(image).toContain("min-height: 0");
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
