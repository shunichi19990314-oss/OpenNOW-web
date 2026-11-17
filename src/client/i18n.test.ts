import { describe, expect, it } from "vitest";

import { getAvailableLocales, resolveInitialLocale } from "./i18n";

import ja from "../../locales/ja.json";
import en from "../../locales/en.json";
import de from "../../locales/de.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ko from "../../locales/ko.json";
import nl from "../../locales/nl.json";
import pl from "../../locales/pl.json";
import ro from "../../locales/ro.json";
import ru from "../../locales/ru.json";
import tr from "../../locales/tr.json";
import zh from "../../locales/zh.json";

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

/**
 * The AI panel prints log lines straight from the loop (already Japanese) plus a
 * few `aiPlayer.*` keys. A missing key renders as the raw dotted key in the UI,
 * which is exactly the "why is this English/why is this code" regression.
 */
describe("AI player translations", () => {
  const bundles: Array<[string, { aiPlayer: Record<string, unknown> }]> = [
    ["ja", ja], ["en", en], ["de", de], ["es", es], ["fr", fr], ["ko", ko],
    ["nl", nl], ["pl", pl], ["ro", ro], ["ru", ru], ["tr", tr], ["zh", zh],
  ];
  const logCodes = [
    "session_expired", "rate_limited", "not_configured", "network",
    "bad_reply", "unknown_action", "input_not_ready", "frame_rejected", "timeout",
  ];

  it("translates every code the loop can emit", () => {
    for (const [locale, bundle] of bundles) {
      const log = bundle.aiPlayer.log as Record<string, string>;
      for (const code of logCodes) {
        expect(log[code], `${locale}.aiPlayer.log.${code}`).toBeTypeOf("string");
        expect(log[code].length).toBeGreaterThan(0);
      }
    }
  });

  it("translates the strings added with the frame-rejection fix", () => {
    for (const [locale, bundle] of bundles) {
      for (const key of ["lastError", "visionUnavailableSwitch", "statFramesHint", "statDropped", "modelSlowWarning", "reload"]) {
        expect(bundle.aiPlayer[key], `${locale}.aiPlayer.${key}`).toBeTypeOf("string");
      }
    }
  });

  it("keeps the Japanese wording Japanese", () => {
    const ai = ja.aiPlayer as Record<string, unknown>;
    const log = ai.log as Record<string, string>;
    for (const text of [ai.lastError as string, ai.visionUnavailableSwitch as string, log.frame_rejected]) {
      expect(text).toMatch(/[\u3040-\u30ff\u4e00-\u9faf]/);
    }
  });
});
