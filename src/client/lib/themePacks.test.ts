import { describe, expect, it } from "vitest";

import { ACCENT_COLOR_OPTIONS, THEME_PACKS, getThemePack, resolveThemePackPalette } from "./themePacks";

/**
 * The eight packs mirror `qml/theme/Theme.qml` in the desktop build. A rename
 * or a dropped pack logs a visitor into a shell whose colours silently fall
 * back to Nocturne, so the roster and its palettes are pinned here.
 */
describe("theme packs", () => {
  it("ships the eight desktop packs in rail order", () => {
    expect(THEME_PACKS.map((pack) => pack.id)).toEqual([
      "nocturne", "aurora", "kraft", "phosphor", "bone", "cobalt", "hibiscus", "chapel",
    ]);
  });

  it("falls back to Nocturne for an unknown or missing id", () => {
    expect(getThemePack(undefined).id).toBe("nocturne");
    expect(getThemePack("nope" as never).id).toBe("nocturne");
  });

  it("resolves light-first packs to their paper shell and light accent", () => {
    const bone = getThemePack("bone");
    expect(resolveThemePackPalette(bone, true)).toMatchObject({ shell: "#EEE7DB", accent: "#7F6A4D", light: true });
    // In dark mode a light-first pack shows the dark shell it lists.
    expect(resolveThemePackPalette(bone, false)).toMatchObject({ shell: "#201D18", accent: "#D3BA91", light: false });
  });

  it("resolves dark-first packs to their light shell in light mode", () => {
    const nocturne = getThemePack("nocturne");
    expect(resolveThemePackPalette(nocturne, false).shell).toBe("#0B0F1A");
    expect(resolveThemePackPalette(nocturne, true).shell).toBe("#EEF3FA");
  });

  it("offers the seven desktop accent presets", () => {
    // `coral` and `white` were missing from the web enum, so a settings file
    // written by the desktop build could not round-trip.
    expect(ACCENT_COLOR_OPTIONS.map((option) => option.value)).toEqual([
      "green", "blue", "violet", "rose", "coral", "amber", "white",
    ]);
    for (const option of ACCENT_COLOR_OPTIONS) {
      expect(option.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(option.lightHex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(option.labelKey.startsWith("settings.interface.accentColor")).toBe(true);
    }
  });
});
