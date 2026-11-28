import type { GameInfo } from "@shared/gfn";

import type { PlaytimeData } from "./gameCatalog";

/**
 * Library playtime summary.
 *
 * The library could only answer "how long did I play *this* game" — the number
 * on each tile. Seeing the total, the session count and which title took the
 * most time needs scrolling and mental arithmetic, so the header gets one line
 * built from the same local tracker the tiles already read.
 *
 * Only games in the given list are counted, so the line always agrees with the
 * tiles next to it (a filtered or searched library summarises what is shown).
 * Seconds are summed as integers; anything non-finite or negative from a
 * hand-edited payload is treated as absent rather than poisoning the total.
 */

export interface LibraryPlaytimeSummary {
  /** Sum of `totalSeconds` across the games, never negative. */
  totalSeconds: number;
  /** Games with any recorded playtime. */
  playedGames: number;
  /** Total games considered, played or not. */
  games: number;
  /** Sessions across all games. */
  sessions: number;
  /** Most-played title, `null` when nothing has been played. */
  topGame: GameInfo | null;
  topGameSeconds: number;
}

function toSeconds(value: unknown): number {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.floor(seconds);
}

export function summarizeLibraryPlaytime(
  games: readonly GameInfo[],
  playtime: PlaytimeData,
): LibraryPlaytimeSummary {
  let totalSeconds = 0;
  let playedGames = 0;
  let sessions = 0;
  let topGame: GameInfo | null = null;
  let topGameSeconds = 0;
  const seen = new Set<string>();

  for (const game of games) {
    if (!game.id || seen.has(game.id)) continue;
    seen.add(game.id);
    const record = playtime[game.id];
    const gameSeconds = toSeconds(record?.totalSeconds);
    sessions += toSeconds(record?.sessionCount);
    if (gameSeconds <= 0) continue;
    playedGames += 1;
    totalSeconds += gameSeconds;
    // Ties keep the first game, which is the page's own order (favourites and
    // recency first), so the "most played" pick is stable between renders.
    if (gameSeconds > topGameSeconds) {
      topGameSeconds = gameSeconds;
      topGame = game;
    }
  }

  return {
    totalSeconds,
    playedGames,
    games: seen.size,
    sessions,
    topGame: topGameSeconds > 0 ? topGame : null,
    topGameSeconds,
  };
}
