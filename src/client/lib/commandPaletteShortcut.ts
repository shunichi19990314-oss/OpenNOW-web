/**
 * Shared Shift for the Ctrl/⌘+K palette shortcut.
 *
 * The palette must open even while an input has focus (that is the point of a
 * command palette), so this check deliberately ignores the typing guard used by
 * the single-key shortcuts. It only claims the exact combination so it can never
 * swallow an in-game Ctrl+K or a browser shortcut.
 */
export function isCommandPaletteShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== "k") return false;
  const primary = event.ctrlKey || event.metaKey;
  return primary;
}

/** True when the event comes from a text entry surface. */
export function isTypingTarget(target: EventTarget | null): boolean {
  // Duck-typed on purpose: the palette is also exercised in non-DOM test shells
  // and during SSR, where `HTMLElement` does not exist.
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!candidate || typeof candidate !== "object") return false;
  if (candidate.isContentEditable === true) return true;
  const tag = typeof candidate.tagName === "string" ? candidate.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
