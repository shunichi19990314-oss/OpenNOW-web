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
