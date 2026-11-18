import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LiquidGlassCanvas, LiquidGlassFilters } from "./LiquidGlass";

/**
 * The liquid-glass layer has two failure modes that a type check cannot catch,
 * and both are invisible in code review:
 *
 *  1. The displacement maps lose their ids. CSS references them by name
 *     (`backdrop-filter: url(#lg-refraction-soft)`), so a rename silently
 *     downgrades every panel to a plain blur — the effect disappears with no
 *     error anywhere.
 *  2. The canvas or the filter defs become interactive or visible. They are
 *     full-viewport overlays mounted before the app; if either captured pointer
 *     events or painted a background, the entire UI would stop responding or be
 *     covered.
 *
 * These are pure render assertions, so they run without a DOM.
 */

describe("LiquidGlassFilters", () => {
  const markup = renderToStaticMarkup(<LiquidGlassFilters />);

  it("exposes the filter ids that the stylesheet references", () => {
    expect(markup).toContain('id="lg-refraction-soft"');
    expect(markup).toContain('id="lg-refraction-strong"');
  });

  it("builds the displacement maps from turbulence plus a displacement node", () => {
    expect(markup).toContain("feTurbulence");
    expect(markup).toContain("feDisplacementMap");
    // Two filters, each with its own noise source. Count opening tags only:
    // these are not void elements, so the closing tag doubles a naive match.
    expect(markup.match(/<feTurbulence[\s>]/g)).toHaveLength(2);
    expect(markup.match(/<feDisplacementMap[\s>]/g)).toHaveLength(2);
    // Each map must be fed by a *smoothed* noise field, not raw turbulence;
    // raw noise warps neighbouring pixels independently and looks like a bug.
    expect(markup.match(/<feGaussianBlur[\s>]/g)).toHaveLength(2);
  });

  it("is hidden from assistive technology and occupies no space", () => {
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('width="0"');
    expect(markup).toContain('height="0"');
  });
});

describe("LiquidGlassCanvas", () => {
  it("renders the three caustic fields and the grain", () => {
    const markup = renderToStaticMarkup(<LiquidGlassCanvas />);
    expect(markup).toContain("lg-canvas__caustic--a");
    expect(markup).toContain("lg-canvas__caustic--b");
    expect(markup).toContain("lg-canvas__caustic--c");
    expect(markup).toContain("lg-canvas__grain");
  });

  it("is inert: hidden from AT and pointer-events:none in the stylesheet", () => {
    const markup = renderToStaticMarkup(<LiquidGlassCanvas />);
    expect(markup).toContain('aria-hidden="true"');
    // The class must be present so `.lg-canvas { pointer-events: none }` applies.
    expect(markup).toContain("lg-canvas");
  });

  it("quiets itself behind the stream view", () => {
    expect(renderToStaticMarkup(<LiquidGlassCanvas muted />)).toContain("lg-canvas--muted");
    expect(renderToStaticMarkup(<LiquidGlassCanvas />)).not.toContain("lg-canvas--muted");
  });
});
