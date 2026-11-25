import { describe, expect, it } from "vitest";

import ja from "../../../locales/ja.json";
import {
  foldSettingsText,
  matchesSettingsQuery,
  tokenizeSettingsQuery,
} from "./settingsSearch";
import { SETTINGS_SCOPE_LABEL_KEYS, SETTINGS_SCOPE_SEARCH_TERMS } from "../components/settings/settingsTypes";

function read(tree: unknown, key: string): string | undefined {
  return key.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    tree,
  ) as string | undefined;
}

/**
 * The settings search tokenized on `/[^a-z0-9]+/`, so every Japanese query
 * produced zero tokens, matched every section, and never showed the "no
 * matches" state. These are the regression tests for the kana-aware search.
 */
describe("settings search", () => {
  it("keeps CJK runs intact and splits Latin punctuation", () => {
    expect(tokenizeSettingsQuery("マイク")).toEqual(["マイク"]);
    expect(tokenizeSettingsQuery("地域・通信")).toEqual(["地域", "通信"]);
    expect(tokenizeSettingsQuery("Push-to-talk")).toEqual(["push", "to", "talk"]);
    expect(tokenizeSettingsQuery("   ")).toEqual([]);
  });

  it("folds width and case like the on-screen text", () => {
    expect(foldSettingsText("ＡＢＣ")).toBe("abc");
    expect(foldSettingsText("テーマ")).toBe("テーマ");
  });

  it("matches Japanese substrings and Latin prefixes", () => {
    expect(matchesSettingsQuery(["マイク"], ["オーディオ", "マイク・送信レベル"])).toBe(true);
    expect(matchesSettingsQuery(["inter"], ["interface", "accent color"])).toBe(true);
    expect(matchesSettingsQuery(["zzz"], ["interface"])).toBe(false);
    // Every needle must match: "テーマ 色" needs both words somewhere, and a
    // needle may be a prefix of an entry (typing "テー" still finds テーマ).
    expect(matchesSettingsQuery(["テーマ", "色"], ["テーマパック", "色の濃さ"])).toBe(true);
    expect(matchesSettingsQuery(["テー"], ["テーマパック"])).toBe(true);
    expect(matchesSettingsQuery(["テーマ", "zzz"], ["テーマパック"])).toBe(false);
  });

  it("finds the right section for a Japanese query", () => {
    // Mirrors SettingsPage.scopeMatchesSearch without the React wrapper.
    const scopeMatches = (scopeId: keyof typeof SETTINGS_SCOPE_SEARCH_TERMS, query: string): boolean => {
      const haystack = [
        ...SETTINGS_SCOPE_SEARCH_TERMS[scopeId],
        scopeId,
        ...(SETTINGS_SCOPE_LABEL_KEYS[scopeId] ?? []).map((key) => read(ja, key) ?? ""),
      ];
      return matchesSettingsQuery(tokenizeSettingsQuery(query), haystack);
    };

    expect(scopeMatches("audio", "マイク")).toBe(true);
    expect(scopeMatches("stream-region", "地域")).toBe(true);
    expect(scopeMatches("interface", "テーマ")).toBe(true);
    expect(scopeMatches("interface", "アクセント")).toBe(true);
    expect(scopeMatches("audio", "テーマ")).toBe(false);
    expect(scopeMatches("about", "存在しない設定")).toBe(false);
  });

  it("points at keys that actually exist in the Japanese bundle", () => {
    for (const [scope, keys] of Object.entries(SETTINGS_SCOPE_LABEL_KEYS)) {
      for (const key of keys) {
        expect(read(ja, key), `${scope} → ${key}`).toBeTypeOf("string");
      }
    }
  });
});
