import { memo, type JSX } from "react";

/**
 * The SVG displacement maps behind the glass.
 *
 * A `feDisplacementMap` driven by a fractal-noise turbulence warps whatever is
 * painted behind an element. Applied through `backdrop-filter`, it bends the
 * canvas *through* the panel — the difference between "a blurry rectangle" and
 * "a piece of glass". Two strengths are defined: `soft` for panels and `strong`
 * for large surfaces like the hero, where a longer throw reads better.
 *
 * The filter region is deliberately oversized (`-20%`) so the displaced edge
 * pixels are not clipped away, and the scale is small (8–14px) because a large
 * displacement turns text underneath into mush instead of a lens.
 *
 * Mounted once, at the root, with zero size: filters are referenced by id from
 * CSS, so they must exist in the document but must not paint anything.
 */
export const LiquidGlassFilters = memo(function LiquidGlassFilters(): JSX.Element {
  return (
    <svg
      className="lg-filter-defs"
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        <filter
          id="lg-refraction-soft"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.014"
            numOctaves={2}
            seed={7}
            result="noise"
          />
          {/* Smooth the noise into a wobbly-but-slow surface: high-frequency
              noise displaces neighbouring pixels randomly and looks like a bug,
              a low-frequency surface looks like the surface of a lens. */}
          <feGaussianBlur in="noise" stdDeviation="6" result="smooth" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="smooth"
            scale={9}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        <filter
          id="lg-refraction-strong"
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.005 0.009"
            numOctaves={3}
            seed={19}
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="10" result="smooth" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="smooth"
            scale={16}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
});

export interface LiquidGlassCanvasProps {
  /**
   * Dim the caustics. The stream view sits on top of the canvas and wants
   * attention, not scenery.
   */
  muted?: boolean;
}

/**
 * The light table the glass sits on.
 *
 * Three slow, blurred colour fields drift behind everything. They exist purely
 * so the material has something to refract: on a flat black page, glass reads as
 * a grey box. Fixed-position and `pointer-events: none`, so it never interferes
 * with input or scroll.
 */
export const LiquidGlassCanvas = memo(function LiquidGlassCanvas({
  muted = false,
}: LiquidGlassCanvasProps): JSX.Element {
  return (
    <div className={`lg-canvas${muted ? " lg-canvas--muted" : ""}`} aria-hidden="true">
      <div className="lg-canvas__caustic lg-canvas__caustic--a" />
      <div className="lg-canvas__caustic lg-canvas__caustic--b" />
      <div className="lg-canvas__caustic lg-canvas__caustic--c" />
      <div className="lg-canvas__grain" />
    </div>
  );
});
