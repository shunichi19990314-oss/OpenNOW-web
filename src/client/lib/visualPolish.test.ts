import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Guard rails for the visual layer.
 *
 * The polish pass is CSS only, so nothing here checks pixels. What it does pin
 * is the set of rules that are easy to lose in a later edit and expensive when
 * lost: the reduced-motion escape hatch, and the accessibility of the accents
 * the polish leans on. A stylesheet regression is invisible in unit tests —
 * these assertions make it visible.
 */

const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

/** Every rule body whose selector mentions the token (bodies never nest here). */
function blocksFor(token: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].includes(token))
    .map((match) => match[2]);
}

/**
 * Every `@media (prefers-reduced-motion: reduce)` block, concatenated.
 *
 * Several exist (the file has grown in passes), so a check that only looked at
 * the last one passed or failed depending on which pass added it.
 */
function reducedMotionBlocks(): string {
  return [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
    .map((match) => match[1])
    .join("\n");
}

describe("reduced motion", () => {
  it("cancels the hero drift and the modal entrance", () => {
    const media = reducedMotionBlocks();
    expect(media).toContain(".home-hero-bg");
    expect(media).toContain(".game-details-modal");
    expect(media).toContain("animation: none");
  });

  it("cancels the card lift and the image sheen", () => {
    const media = reducedMotionBlocks();
    expect(media).toContain(".game-card:hover");
    expect(media).toContain("transform: none");
    // The sweep is pure decoration; freezing it mid-card would look broken.
    expect(media).toContain("display: none");
  });
});

describe("hover polish does not break interaction", () => {
  it("keeps the sheen overlay out of the pointer path", () => {
    const blocks = blocksFor("game-card-image-wrapper::after");
    expect(blocks.length).toBeGreaterThan(0);
    // At least the rule that paints the sweep must not swallow clicks.
    expect(blocks.some((block) => block.includes("pointer-events: none"))).toBe(true);
    expect(blocks.some((block) => block.includes("linear-gradient"))).toBe(true);
  });

  it("only scales the image, never the card, on hover", () => {
    // The card lifts by a few pixels; the artwork must not be scaled past a
    // small crop or the poster art turns into a zoomed fragment.
    const hoverImage = css.match(/\.game-card:hover \.game-card-image \{([^}]*)\}/);
    expect(hoverImage?.[1]).toContain("filter");
    expect(hoverImage?.[1]).not.toMatch(/scale\(1\.[2-9]/);
  });

  it("keeps the row scroller's clipping box open for lifted cards", () => {
    // Two rules target the scroller: the layout one and the polish override.
    const blocks = blocksFor("home-row-scroller");
    expect(blocks.some((block) => block.includes("overflow-x: auto"))).toBe(true);
    expect(blocks.some((block) => block.includes("padding-top"))).toBe(true);
  });
});

describe("theme coverage", () => {
  it("gives light mode its own background composition", () => {
    // A dark vignette on a white page reads as a dirty edge.
    expect(css).toContain('[data-theme="light"] .app-container');
  });

  it("uses theme tokens rather than hard-coded colours for the new glow", () => {
    const polish = css.slice(css.indexOf("VISUAL POLISH PASS"));
    expect(polish).toContain("var(--accent)");
    expect(polish).toContain("var(--shadow-md)");
    // A literal green would survive a theme-pack change and clash with it.
    expect(polish).not.toMatch(/#58d98a/i);
  });

  it("keeps a visible focus ring for keyboard visitors", () => {
    expect(css).toContain(".game-card:focus-visible");
    const ring = css.match(/\.game-card:focus-visible[^{]*\{([^}]*)\}/);
    expect(ring?.[1]).toContain("outline");
  });
});
