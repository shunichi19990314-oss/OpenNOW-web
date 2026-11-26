/**
 * Hidden games ("Hide from library" in the desktop Library's tile menu).
 *
 * The desktop build keeps the ids in settings (`hiddenGameIds`) and hides those
 * games from the Library grid and the command palette; a game that is hidden is
 * still launchable from Home, and the Library grows a "Hidden" chip so the state
 * is reversible. Everything here is pure so the rules are testable.
 */

/** Quick-filter id for "only the games I hid". */
export const HIDDEN_FILTER_ID = "visibility:hidden";

function normalizedIds(ids: readonly string[] | undefined): string[] {
  return (ids ?? []).filter((id) => typeof id === "string" && id.trim().length > 0);
}

export function toHiddenIdSet(ids: readonly string[] | undefined): Set<string> {
  return new Set(normalizedIds(ids));
}

export function isGameHidden(
  game: { id: string } | null | undefined,
  ids: readonly string[] | undefined,
): boolean {
  if (!game?.id) return false;
  return toHiddenIdSet(ids).has(game.id);
}

/** Adds or removes an id, keeping the stored order stable. */
export function toggleHiddenGameId(ids: readonly string[] | undefined, gameId: string): string[] {
  const current = normalizedIds(ids);
  if (!gameId) return current;
  return current.includes(gameId)
    ? current.filter((id) => id !== gameId)
    : [...current, gameId];
}

/**
 * Apply the hidden state to a list.
 *
 * `showHidden` is the "Hidden" chip: it shows exactly the hidden games instead
 * of everything else, which is how a game is restored.
 */
export function filterHiddenGames<T extends { id: string }>(
  games: readonly T[],
  ids: readonly string[] | undefined,
  showHidden = false,
): T[] {
  const hidden = toHiddenIdSet(ids);
  return games.filter((game) => hidden.has(game.id) === showHidden);
}
