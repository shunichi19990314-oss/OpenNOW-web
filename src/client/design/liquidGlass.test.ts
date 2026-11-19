import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrast floor for the Liquid Glass material.
 *
 * The first build of this design shipped text at 1.8:1 (white on the accent
 * pill) and 2.76:1 (legacy muted ink on the settings panels) because the values
 * were chosen by eye. Nobody noticed until screenshots came back saying "hard to
 * read". These tests read the *shipped stylesheet* and compute the composed
 * ratios, so the same mistake cannot be reintroduced quietly.
 *
 * They are deliberately arithmetic, not a snapshot: a designer can still change
 * a colour, but they have to keep the numbers above the floor.
 */

const css = readFileSync(
  fileURLToPath(new URL("../design/liquidGlass.css", import.meta.url)),
  "utf8",
);
const baseCss = readFileSync(
  fileURLToPath(new URL("../styles.css", import.meta.url)),
  "utf8",
);

type Rgb = [number, number, number];

function hex(value: string): Rgb {
  const v = value.replace("#", "").trim();
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** Composite `fg` at `alpha` over `bg` — what the eye actually sees. */
function over(alpha: number, fg: Rgb, bg: Rgb): Rgb {
  return [
    Math.round(alpha * fg[0] + (1 - alpha) * bg[0]),
    Math.round(alpha * fg[1] + (1 - alpha) * bg[1]),
    Math.round(alpha * fg[2] + (1 - alpha) * bg[2]),
  ];
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Read a custom property for a selector, honouring the cascade.
 *
 * Two details matter and both were bugs in the first version of this helper:
 *
 *   * Selector *lists*: the light material is declared as
 *     `[data-theme="light"], .lg-light-context { ... }`, so matching only
 *     `selector {` silently skipped the block and made the test assert against
 *     a value the app never used.
 *   * `var()` references: components override `--lg-tint-a` with
 *     `var(--lg-tint-strong-a)`, which must be resolved to a number.
 *
 * The last declaration wins, as in a browser.
 */
interface Rule {
  prelude: string;
  body: string;
}

function rules(source: string): Rule[] {
  // Strip comments first: they contain prose with braces and commas.
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Rule[] = [];
  let cursor = 0;
  while (cursor < clean.length) {
    const open = clean.indexOf("{", cursor);
    if (open === -1) break;
    // Walk back to the start of the prelude.
    let start = open - 1;
    while (start >= 0 && !"};{".includes(clean[start])) start -= 1;
    const prelude = clean.slice(start + 1, open).trim();
    // Find the matching close brace (blocks here are one level deep, but nested
    // at-rules exist, so count depth).
    let depth = 0;
    let close = open;
    for (; close < clean.length; close += 1) {
      if (clean[close] === "{") depth += 1;
      else if (clean[close] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push({ prelude, body: clean.slice(open + 1, close) });
    cursor = close + 1;
  }
  return found;
}

const RULES = rules(css);

function token(selector: string, name: string, source = css): string | null {
  const parsed = source === css ? RULES : rules(source);
  let value: string | null = null;
  for (const rule of parsed) {
    // The selector must appear as one item of the prelude's selector list.
    const matches = rule.prelude
      .split(",")
      .some((part) => part.trim() === selector);
    if (!matches) continue;
    const match = new RegExp(`(?:^|\\s)${name}\\s*:\\s*([^;]+);`).exec(rule.body);
    if (match) value = match[1].trim();
  }
  if (value === null) return null;

  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (reference) {
    return token(selector, reference[1], source) ?? token(":root", reference[1], source);
  }
  return value;
}

function number(value: string | null, label: string): number {
  if (value === null) throw new Error(`missing token: ${label}`);
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) throw new Error(`not a number: ${label}=${value}`);
  return parsed;
}

/** The brightest backdrop a panel can sit over: a dimmed caustic peak. */
const WORST_BACKDROP = hex("#2b2446");

describe("ink tokens", () => {
  it("keeps the legacy muted tokens above 4.5:1 — they are used by every old panel", () => {
    // These come from styles.css but are raised in liquidGlass.css, which loads
    // afterwards; asserting the raised values is the point.
    const soft = token(":root", "--ink-soft");
    const muted = token(":root", "--ink-muted");
    expect(soft).toBeTruthy();
    expect(muted).toBeTruthy();

    // `--ink-soft` and `--ink-muted` are *ink* colours, so they must be light on
    // the dark material.
    expect(contrast(hex(soft!), WORST_BACKDROP)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(muted!), WORST_BACKDROP)).toBeGreaterThanOrEqual(4.5);
  });

  it("does not lose the raised inks to a later light-theme block", () => {
    // The light theme sets its own surfaces; if it also reset the tint alpha low
    // the panels would go translucent again for anyone on that theme.
    const lightTint = token('[data-theme="light"]', "--lg-tint-a");
    const darkTint = token(":root", "--lg-tint-a");
    expect(number(lightTint, "light tint")).toBeGreaterThanOrEqual(
      number(darkTint, "dark tint") - 0.05,
    );
  });
});

describe("material tint floor", () => {
  const surfaces: Array<[string, Rgb]> = [
    ["reading surface", over(0.9, hex("#0b0e13"), WORST_BACKDROP)],
    ["glass panel", over(0.84, hex("#0c0f14"), WORST_BACKDROP)],
    ["dock", over(0.72, hex("#0c0f14"), WORST_BACKDROP)],
  ];

  it.each(surfaces)("keeps body ink readable on the %s", (_label, surface) => {
    // 4.5:1 is the AA floor for normal text; body copy is 0.8rem here, so it
    // does not get the large-text exemption.
    expect(contrast(surface, hex("#c2cad6"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(surface, hex("#cdd4de"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(surface, hex("#a3acba"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the tint high enough that the backdrop cannot wash text out", () => {
    for (const selector of [":root", '[data-theme="light"]']) {
      const tint = token(selector, "--lg-tint-a");
      expect(number(tint, `${selector} tint`), selector).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("has no component quietly lowering the tint below the floor", () => {
    // The viscosity classes (`.lg-thin`, `.lg-nav`, `.sload`) used to hard-code
    // their own low alphas *on the element*, which wins over the `:root` floor
    // and re-introduced the washed-out panels. Thinness is expressed with blur
    // and shadow now; every literal alpha must stay at or above the floor.
    // Strip comments first: the stylesheet *discusses* the old 0.34 value at
    // length, and a naive scan would read the prose as a declaration.
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const literals = [...declarations.matchAll(/--lg-tint-(?:a|strong-a|rail-a)\s*:\s*(0?\.\d+)/g)]
      .map((match) => Number.parseFloat(match[1]))
      .filter((value) => value < 0.7);
    // There is exactly one declaration of each tint level for dark, and one for
    // the light material; both must clear the floor.
    expect(literals).toEqual([]);
  });
});

describe("accent-filled controls", () => {
  /**
   * `--accent` is user-selectable, and the old rule asked the *theme* for the
   * label colour instead of the button's own fill. With the default green that
   * produced white text on a light pill: 1.79:1 — the unreadable blue "プレイ"
   * button in the report.
   */
  const accents = [
    ["green", "#58d98a"],
    ["blue", "#4f8cff"],
    ["violet", "#8b6cff"],
    ["amber", "#f5b942"],
    ["rose", "#ff6b9a"],
  ] as const;

  it.each(accents)("uses a readable label on the %s accent", (_name, fill) => {
    const ink = token(":root", "--accent-ink") ?? token(":root", "--accent-on");
    expect(ink, "no accent ink token").toBeTruthy();
    expect(contrast(hex(fill), hex(ink!))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the app's own accent palette as the source of truth", () => {
    // Guards against the stylesheet drifting away from uiCustomization.ts: the
    // tests above only mean something if these are the real values.
    const options = readFileSync(
      fileURLToPath(new URL("../lib/uiCustomization.ts", import.meta.url)),
      "utf8",
    );
    for (const [, fill] of accents) {
      expect(options.toLowerCase()).toContain(fill.toLowerCase());
    }
  });
});

describe("semantic status pills", () => {
  it.each([
    ["good", "#15803d"],
    ["medium", "#a16207"],
    ["poor", "#b91c1c"],
  ])("keeps white text at 4.5:1 on the %s latency pill", (_label, fill) => {
    expect(contrast(hex(fill), hex("#ffffff"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("stylesheet hygiene", () => {
  it("defines every custom property it uses", () => {
    const defined = new Set(
      [...`${css}\n${baseCss}`.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    );
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });

  it("balances its braces", () => {
    expect((css.match(/\{/g) ?? []).length).toBe((css.match(/\}/g) ?? []).length);
  });
});

/**
 * Theme coherence.
 *
 * Both reported "text still blends into the background" screenshots were the
 * *light* theme: the ink tokens were light-theme values (#101a2c headings,
 * #33405a body — measured straight off the image) painted on a surface that was
 * still dark. The tokens were correct; the surface was the wrong colour.
 *
 * Three independent causes fed that, and each gets an assertion:
 *
 *   1. The canvas was declared only in `:root`, so a pale sheet sat on a
 *      near-black page.
 *   2. `.animated-modal-panel` forced a dark fill with `!important`, which
 *      outranks every later light-theme rule and pinned every dialog in the
 *      product to near-black.
 *   3. Nothing checked that a theme's ink and its own surface agree, so a
 *      half-inverted theme could ship green.
 *
 * The invariant these enforce is the one that was missing: *a theme must change
 * the surface, the canvas and the ink together, or not at all.*
 */
describe("theme coherence", () => {
  const LIGHT = '[data-theme="light"]';

  /** A light theme defines its own canvas; inheriting the dark one is the bug. */
  it.each(["--lg-canvas-1", "--lg-canvas-2", "--lg-canvas-3"])(
    "recolours the canvas for the light theme (%s)",
    (name) => {
      const light = token(LIGHT, name);
      const dark = token(":root", name);
      expect(light, `${name} is not themed`).toBeTruthy();
      expect(light).not.toBe(dark);
      // And it must actually be lighter, not merely different.
      expect(luminance(hex(light!))).toBeGreaterThan(luminance(hex(dark!)));
    },
  );

  it("gives the light theme ink that is readable on the surface it paints", () => {
    // Composite the light reading surface over the light canvas — what the eye
    // sees inside the settings dialog.
    const canvas = hex(token(LIGHT, "--lg-canvas-1")!);
    const solid = token(LIGHT, "--lg-surface-solid")!;
    const match = /rgba?\(([^)]+)\)/.exec(solid);
    expect(match, `unparseable surface: ${solid}`).toBeTruthy();
    const parts = match![1].split(",").map((n) => Number.parseFloat(n.trim()));
    const surface = over(parts[3] ?? 1, [parts[0], parts[1], parts[2]], canvas);

    for (const name of ["--lg-surface-body-ink", "--lg-surface-label-ink"]) {
      const ink = hex(token(LIGHT, name)!);
      // A light theme's ink must be *darker* than its surface. This is the exact
      // check that would have caught dark-navy ink on a near-black panel.
      expect(luminance(ink), `${name} is not dark ink`).toBeLessThan(luminance(surface));
      expect(contrast(ink, surface), `${name} on the light surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * The settings dialog contains components that were written when the panel
   * was dark. A dark card inside a light dialog is the same defect as dark ink
   * on a dark panel: the surface stops matching the theme.
   *
   * Class names are no longer checked here — the question that matters is
   * "what surface does this element paint, and would it be dark under the light
   * theme?". A covering mask (used for floating layers that must stay dark, such
   * as a media scrim) is the explicit, visible opt-out.
   */
  it("keeps every settings surface light without needing a dark-covering mask", () => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const parsed = rules(clean);

    type Fill = { selector: string; alpha: number; color: string };
    const darkFills: Fill[] = [];
    for (const rule of parsed) {
      for (const selector of rule.prelude.split(",").map((part) => part.trim())) {
        if (!selector || selector.includes("data-theme") || !selector.includes("settings")) continue;
        const match = /background(?:-color)?\s*:\s*rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/.exec(rule.body);
        if (!match) continue;
        const color = hex(
          `#${Number(match[1]).toString(16).padStart(2, "0")}${Number(match[2]).toString(16).padStart(2, "0")}${Number(match[3]).toString(16).padStart(2, "0")}`,
        );
        // "Dark" means it would leave a dark cast on a white sheet.
        if (luminance(color) < 0.2) {
          darkFills.push({ selector, alpha: Number.parseFloat(match[4]), color: match[0] });
        }
      }
    }

    // Each such fill must be neutralised by a themed override *or* by the mask.
    const unmasked = darkFills.filter(({ selector, alpha }) => {
      // A near-transparent dark tint is a shadow, not a surface.
      if (alpha <= 0.1) return false;
      const themed = parsed.some((rule) =>
        rule.prelude.split(",").some((part) => part.trim() === `${LIGHT} ${selector}`),
      );
      if (themed) return false;
      const masked = parsed.some(
        (rule) =>
          rule.prelude.split(",").some((part) => part.trim() === "[data-msurface]") &&
          rule.prelude.includes(selector),
      );
      return !masked;
    });
    expect(unmasked.map(({ selector, color }) => `${selector} => ${color}`)).toEqual([]);
  });

  it("captures --lg-ink in the light material", () => {
    const light = token(LIGHT, "--lg-ink");
    const dark = token(":root", "--lg-ink");
    expect(light, "the light material inherits the dark ink").toBeTruthy();
    expect(luminance(hex(light!))).toBeLessThan(luminance(hex(dark!)));
  });
});

/**
 * Compositing budget.
 *
 * "UIが少し重い" is not a taste complaint — it is a frame-time budget, and the
 * things that blow it are specific and measurable in the stylesheet. Each test
 * here corresponds to a cost that was actually present:
 *
 *   * an SVG displacement chain fed to `backdrop-filter` (the most expensive
 *     effect available, re-run on every repaint of a fixed-position element);
 *   * `will-change: transform` applied broadly, which pins one compositor layer
 *     per interactive element and keeps it resident;
 *   * a blurred layer animated with `scale()`, which forces the rasteriser to
 *     redo the blur instead of reusing the texture;
 *   * an oversized grain layer (4× the viewport) under `mix-blend-mode`.
 *
 * The thresholds are deliberately loose — this is not a micro-benchmark, it is a
 * guard against reintroducing the expensive version.
 */
describe("compositing budget", () => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const parsed = rules(clean);

  /** Declarations that apply unconditionally (not inside an opt-in scope). */
  function unconditionalBackdropFilters(): Array<{ selector: string; value: string }> {
    const found: Array<{ selector: string; value: string }> = [];
    for (const rule of parsed) {
      // Skip at-rule preludes: `rules()` walks braces, so a `@supports (...)`
      // containing declarations surfaces as a rule whose prelude is the at-rule
      // itself. Its body is the *scope*, not a selector that applies.
      if (rule.prelude.startsWith("@")) continue;
      // The opt-in scope is the only place displacement is allowed.
      if (rule.prelude.includes(".lg-refract-on")) continue;
      // Collect *every* declaration in the block, not just the first: a rule
      // usually carries the `-webkit-` and the standard property, and taking
      // only one of them let a regression hide in the other.
      for (const match of rule.body.matchAll(/(?:^|[;{\s])(?:-webkit-)?backdrop-filter\s*:\s*([^;]+);/g)) {
        for (const selector of rule.prelude.split(",").map((p) => p.trim())) {
          found.push({ selector, value: match[1].trim() });
        }
      }
    }
    return found;
  }

  it("never feeds an SVG filter to backdrop-filter outside the opt-in scope", () => {
    // `url(#...)` in a backdrop filter means feTurbulence + feDisplacementMap
    // over the element's whole backdrop, on every repaint.
    const offenders = unconditionalBackdropFilters().filter((entry) => /url\(/.test(entry.value));
    expect(offenders).toEqual([]);
  });

  it("keeps every unconditional backdrop blur within the cost budget", () => {
    // 40px+ was common before this pass; past ~32px the difference is invisible
    // on a surface that is already 80%+ opaque, and the cost is superlinear.
    const tooLarge = unconditionalBackdropFilters()
      .flatMap((entry) => [...entry.value.matchAll(/blur\((\d+)px\)/g)].map((m) => ({
        selector: entry.selector,
        radius: Number(m[1]),
      })))
      .filter((entry) => entry.radius > 32);
    expect(tooLarge).toEqual([]);
  });

  it("does not pin a compositor layer for every interactive element", () => {
    // `will-change` is per-element and permanent; on a grid of cards it is a
    // layer per card. It is only justified on large, singular surfaces.
    const hinted = parsed
      .filter((rule) => /will-change\s*:\s*transform/.test(rule.body))
      .flatMap((rule) => rule.prelude.split(",").map((p) => p.trim()));

    expect(hinted.length).toBeGreaterThan(0);
    // Anything hint-able must be a single large surface, never a generic
    // utility that many elements share.
    expect(hinted).not.toContain(".lg-interactive");
  });

  it("animates blurred layers with translation only", () => {
    // Scaling a blurred layer re-runs the blur; translating does not.
    const drift = parsed.find((rule) => rule.prelude.includes("lg-drift"));
    expect(drift, "lg-drift keyframes").toBeTruthy();
    expect(drift!.body).not.toContain("scale(");
  });

  it("keeps the grain layer viewport-sized rather than oversized", () => {
    const grain = parsed.find((rule) => rule.prelude.trim() === ".lg-canvas__grain");
    expect(grain, "grain rule").toBeTruthy();
    const body = css.slice(css.indexOf(".lg-canvas__grain"));
    const block = body.slice(0, body.indexOf("}"));
    // `inset: -50%` made it 2× the viewport in each axis (4× the pixels).
    expect(block).not.toMatch(/inset\s*:\s*-/);
  });

  it("offers a no-blur path for reduced-transparency users", () => {
    // Also the right fallback for a struggling machine: one rule removes every
    // backdrop filter in the product.
    expect(clean).toContain("prefers-reduced-transparency");
    expect(clean).toMatch(/backdrop-filter\s*:\s*none\s*!important/);
  });
});
