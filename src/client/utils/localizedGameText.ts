const HANGUL_RE = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;

/**
 * NVIDIA's catalog can occasionally return mixed-locale long descriptions
 * even when ja_JP is requested. Keep only paragraphs without Hangul so the
 * Japanese UI never presents Korean blocks as if they were Japanese.
 */
export function getJapaneseGameDescription(
  longDescription: string | undefined,
  description: string | undefined,
  fallback: string,
): string {
  const source = longDescription?.trim() || description?.trim();
  if (!source) return fallback;

  const paragraphs = source
    .split(/\n{2,}|(?=\n?\s*[□■•●])/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0 && !HANGUL_RE.test(paragraph));

  return paragraphs.join("\n\n").trim() || fallback;
}
