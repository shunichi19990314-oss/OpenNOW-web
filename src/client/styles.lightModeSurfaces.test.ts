import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for light mode readability on Home / Library.
 *
 * The catalog pages paint the `.catalog-atmosphere` shader behind the content.
 * Its fragment shader is authored for the dark controller shell (base colour
 * `vec3(0.004, 0.008, 0.009)`), and the "continue playing" tiles were styled
 * with a translucent white wash that only reads on that dark shell. In the
 * light appearance the two combined into a grey page: card titles landed at
 * roughly 3.5:1 and the muted metadata line under 2:1.
 *
 * These checks keep every surface in that path on the design tokens, which the
 * colour pack writes for both appearances (`applyThemePack` in
 * `lib/uiCustomization.ts`).
 */
const cssPath = fileURLToPath(new URL("./styles.css", import.meta.url));
const root = postcss.parse(readFileSync(cssPath, "utf8"));

function rulesFor(selector: string): Rule[] {
  const found: Rule[] = [];
  root.walkRules((rule) => {
    if (rule.selector.trim() === selector) found.push(rule);
  });
  return found;
}

function declarations(selector: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of rulesFor(selector)) {
    rule.walkDecls((decl) => {
      map.set(decl.prop, decl.value.trim());
    });
  }
  return map;
}

/** Any literal white overlay (`rgba(255, 255, 255, …)`) is dark-mode-only. */
const LITERAL_WHITE = /rgba\(\s*255\s*,\s*255\s*,\s*255/;

function declarationsOfFamily(prefix: string): Array<{ selector: string; prop: string; value: string }> {
  const found: Array<{ selector: string; prop: string; value: string }> = [];
  root.walkRules((rule) => {
    if (!rule.selector.includes(prefix)) return;
    if (rule.selector.includes('[data-theme="light"]')) return;
    rule.walkDecls((decl) => {
      found.push({ selector: rule.selector.trim(), prop: decl.prop, value: decl.value.trim() });
    });
  });
  return found;
}

describe("continue playing rail surfaces", () => {
  it("paints the tile from tokens instead of a dark-only white wash", () => {
    const tile = declarations(".home-continue-tile");
    expect(tile.get("background")).toBe("var(--card)");
    expect(tile.get("border")?.startsWith("1px solid var(--panel-border)")).toBe(true);
  });

  it("never uses a literal white overlay on any continue-tile surface", () => {
    const offenders = declarationsOfFamily(".home-continue-tile").filter((decl) =>
      LITERAL_WHITE.test(decl.value),
    );
    expect(offenders).toEqual([]);
  });

  it("does not darken the accent with black for the hover play button", () => {
    // `color-mix(… var(--accent) 88%, #000)` was invisible against a light
    // card; the button now uses the accent fill plus the computed on-accent ink.
    const play = declarations(".home-continue-tile-play");
    expect(play.get("background")).toBe("var(--accent)");
    expect(play.get("color")).toBe("var(--accent-on)");
    expect(play.get("background")?.includes("#000")).not.toBe(true);
  });

  it("gives the metadata lines a light-mode contrast lift", () => {
    const meta = declarations('[data-theme="light"] .home-continue-tile-meta');
    const muted = declarations('[data-theme="light"] .home-continue-tile-meta--muted');
    // Both must resolve to a solid-ish ink mix rather than the 55% alpha token,
    // which is tuned for the near-black dark shell.
    expect(meta.get("color")).toContain("color-mix");
    expect(muted.get("color")).toContain("color-mix");
    expect(meta.get("color")).toContain("var(--ink)");
    expect(muted.get("color")).toContain("var(--ink)");
  });

  it("keeps the compact continue card on tokens too", () => {
    const card = declarations(".home-continue-card");
    expect(card.get("background")).toContain("var(--card)");
    expect(LITERAL_WHITE.test(card.get("background") ?? "")).toBe(false);
    expect(card.get("border")?.includes("var(--panel-border)")).toBe(true);

    const play = declarations(".home-continue-play");
    expect(play.get("color")).toBe("var(--accent-on)");
    expect(play.get("background")).toBe("var(--accent)");
  });
});

describe("catalog atmosphere in light mode", () => {
  it("fades the dark shader instead of washing the page grey", () => {
    const light = declarations('[data-theme="light"] .catalog-atmosphere.shader-atmosphere--controller');
    const base = declarations(".catalog-atmosphere.shader-atmosphere--controller");
    const lightOpacity = Number.parseFloat(light.get("opacity") ?? "NaN");
    const baseOpacity = Number.parseFloat(base.get("opacity") ?? "NaN");
    expect(Number.isFinite(lightOpacity)).toBe(true);
    expect(Number.isFinite(baseOpacity)).toBe(true);
    expect(lightOpacity).toBeLessThan(baseOpacity);
  });

  it("repaints the no-WebGL fallback background from tokens", () => {
    const light = declarations('[data-theme="light"] .catalog-atmosphere.shader-atmosphere--controller');
    const background = light.get("background") ?? "";
    expect(background).toContain("var(--bg-a)");
    // The dark fallback keeps its fixed near-black backdrop for the stream
    // overlays, but the light rule must not inherit it.
    expect(background).not.toContain("#020605");
  });
});
