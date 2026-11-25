/**
 * Unicode-aware matching for the settings search box.
 *
 * The search used to tokenize with `/[^a-z0-9]+/`, so a Japanese query
 * ("あくせす", "通信", "マイク") tokenized to nothing and every section was
 * considered a match — typing Japanese silently stopped filtering. The same
 * bug hid the "no matches" state. Japanese has no spaces, so substring
 * matching (not word splitting) is the only thing that works for both
 * scripts: kana and kanji are compared as-is, Latin is lower-cased.
 */

/** Normalize width (ＡＢＣ / １２３ → ABC / 123) and case. */
export function foldSettingsText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

/**
 * Split a query into searchable needles.
 *
 * Separators split words, and so does intra-word punctuation (`push-to-talk`
 * must still find "Push to talk", which is how the term lists spell it). CJK
 * runs have no such punctuation in practice, so 「地域・通信」 splits on the
 * interpunct while 「テーマ」 stays one needle.
 */
export function tokenizeSettingsQuery(query: string): string[] {
  const folded = foldSettingsText(query.trim());
  if (!folded) return [];
  const tokens = folded
    .split(/[\s,、。/|・:;()（）「」\-_.]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return [...new Set(tokens)];
}

/**
 * True when every needle appears in at least one haystack entry, or is a
 * prefix of one. Prefix matching keeps "inter" finding "interface" while
 * substring matching makes "設定" find "設定を開く".
 */
export function matchesSettingsQuery(needles: readonly string[], haystack: readonly string[]): boolean {
  if (needles.length === 0) return true;
  const foldedHaystack = haystack.map((entry) => foldSettingsText(entry));
  return needles.every((needle) => foldedHaystack.some(
    (entry) => entry === needle || entry.includes(needle) || needle.startsWith(entry),
  ));
}
