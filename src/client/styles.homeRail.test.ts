import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the Home rails' horizontal scrollbar.
 *
 * A visible bar under every rail was the brightest line on the page, and the
 * bar that Chrome actually painted came from the OS, not from
 * `::-webkit-scrollbar`: declaring `scrollbar-width` makes Chromium 121+
 * ignore the WebKit pseudo-elements and fall back to the UA scrollbar, whose
 * colour is `scrollbar-color: auto` (a light grey even in dark mode). The fix
 * is to hide the bar outright, so both engines agree.
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

describe("home rail scrollbars", () => {
  it("hides the home rail scrollbar in both engines", () => {
    const base = declarations(".home-row-scroller");
    expect(base.get("scrollbar-width")).toBe("none");
    expect(declarations(".home-row-scroller::-webkit-scrollbar").get("display")).toBe("none");
  });

  it("does not reintroduce a legacy `thin` width that hands the bar back to the OS", () => {
    // `thin` without `scrollbar-color` is exactly the bug: Chromium drops the
    // ::-webkit-scrollbar styling and paints the light UA default.
    expect(declarations(".home-row-scroller").has("scrollbar-width")).toBe(true);
    expect(declarations(".home-row-scroller").get("scrollbar-width")).not.toBe("thin");
  });

  it("keeps the rail horizontally scrollable", () => {
    expect(declarations(".home-row-scroller").get("overflow-x")).toBe("auto");
  });

  it("never declares a native scrollbar width without a colour", () => {
    // Any element that opts into the CSS scrollbar properties must also set
    // `scrollbar-color`; otherwise Chromium stops honouring
    // `::-webkit-scrollbar` and draws the light UA bar on our dark panels.
    const offenders: string[] = [];
    root.walkRules((rule) => {
      if (rule.selector.includes("::")) return;
      const width = rule.nodes.find(
        (node) => node.type === "decl" && node.prop === "scrollbar-width",
      ) as { value: string } | undefined;
      if (!width) return;
      if (width.value.trim() === "none") return; // hidden: colour is moot
      const colour = rule.nodes.find(
        (node) => node.type === "decl" && node.prop === "scrollbar-color",
      );
      if (!colour) offenders.push(`${rule.selector} { scrollbar-width: ${width.value} }`);
    });
    expect(offenders).toEqual([]);
  });
});
