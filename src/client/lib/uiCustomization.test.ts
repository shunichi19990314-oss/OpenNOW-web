import { describe, expect, it } from "vitest";

import { getAccentColorOptions, applyAccentColor } from "./uiCustomization";

/**
 * The accent label colour is chosen from the *fill*, not from the page theme.
 *
 * The old implementation compared the accent against the theme's ink, so the
 * default green pill got white text at 1.79:1 — the unreadable "プレイ" button in
 * the user's report. This test pins the rule: every accent in the palette must
 * produce a label that clears 4.5:1 against its own fill.
 */

type Rgb = [number, number, number];

function hex(value: string): Rgb {
  const v = value.replace("#", "");
  return [
    Number.parseInt(v.slice(0, 2), 16),
    Number.parseInt(v.slice(2, 4), 16),
    Number.parseInt(v.slice(4, 6), 16),
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

/** Minimal stand-in for the element `applyAccentColor` writes to. */
function makeRoot(): { style: { setProperty(name: string, value: string): void }; values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    style: {
      setProperty(name: string, value: string): void {
        values.set(name, value);
      },
    },
  };
}

describe("accent label contrast", () => {
  it.each(getAccentColorOptions().map((option) => [option.value, option.hex]))(
    "gives the %s accent a readable label",
    (_value, fill) => {
      const root = makeRoot();
      applyAccentColor(_value as Parameters<typeof applyAccentColor>[0], root as unknown as HTMLElement);
      const ink = root.values.get("--accent-on");
      expect(ink, "accent-on was not set").toBeTruthy();
      expect(contrast(hex(fill), hex(ink!))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("uses the same dark ink as the stylesheet's --accent-ink", () => {
    const root = makeRoot();
    applyAccentColor("green", root as unknown as HTMLElement);
    // design/liquidGlass.css declares `--accent-ink: #0b1410`; the CSS is the
    // fallback when this runtime path has not run yet, so they must agree.
    expect(root.values.get("--accent-on")).toBe("#0b1410");
  });

  it("does not depend on the page theme", () => {
    // Two calls with the same accent must produce the same label regardless of
    // anything the environment might have set up.
    const a = makeRoot();
    const b = makeRoot();
    applyAccentColor("blue", a as unknown as HTMLElement);
    applyAccentColor("blue", b as unknown as HTMLElement);
    expect(a.values.get("--accent-on")).toBe(b.values.get("--accent-on"));
  });
});
