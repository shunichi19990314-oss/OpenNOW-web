import { describe, expect, it } from "vitest";

import { getAvailableLocales, resolveInitialLocale } from "./i18n";

/**
 * The settings screen ships a language dropdown for every bundled locale. Two
 * regressions are guarded here: `availableLocales` collapsing to Japanese only
 * (making the dropdown a single dead option) and a saved choice being dropped
 * on reload.
 */
describe("available locales", () => {
  it("exposes every bundled translation file", () => {
    const locales = getAvailableLocales();
    expect(locales).toContain("ja");
    // The 12 shipped locales; a missing file is a broken build, not a warning.
    for (const locale of ["en", "de", "es", "fr", "ko", "nl", "pl", "ro", "ru", "tr", "zh"]) {
      expect(locales).toContain(locale);
    }
    expect(new Set(locales).size).toBe(locales.length);
  });
});

describe("resolveInitialLocale", () => {
  const available = ["ja", "en", "de"] as const;

  it("defaults to Japanese without a stored choice", () => {
    expect(resolveInitialLocale(null, available)).toBe("ja");
    expect(resolveInitialLocale("", available)).toBe("ja");
  });

  it("restores the locale the visitor picked", () => {
    expect(resolveInitialLocale("de", available)).toBe("de");
  });

  it("normalizes region and underscore variants", () => {
    expect(resolveInitialLocale("EN_us", available)).toBe("en");
    expect(resolveInitialLocale("de-AT", available)).toBe("de");
  });

  it("ignores locales that are not bundled", () => {
    expect(resolveInitialLocale("xx", available)).toBe("ja");
    expect(resolveInitialLocale("  ", available)).toBe("ja");
  });
});
