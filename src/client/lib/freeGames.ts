import type { GameInfo } from "@shared/gfn";

import { gameIsFreeToPlay, gameIsOwnedByAccount, type GameAccess } from "./gameAccess";

/**
 * Free-to-play titles.
 *
 * A paid title has to be bought in Steam / Epic / … before GeForce NOW will
 * launch it; a free-to-play title does not. That is the one case where
 * "getting the game here" is real rather than a hand-off: there is nothing to
 * pay, so the shell itself can put the title into the account's GFN library
 * (the desktop client's `AddOwnedVariant`, exposed as `POST /api/mark-owned`)
 * and the next launch starts straight from ライブラリ.
 *
 * What the shell cannot do is grant a *store* license — for a limited-time
 * giveaway (an Epic free week, for example) the free license is still claimed
 * on that store's own page. `freeGamesNeedingStorePage` marks that case apart
 * from plain free-to-play, where no store visit is needed at all.
 */

/** Detected from `playType` / feature labels / SKU tags (`gameAccess.ts`). */
export function isFreePlayGame(game: GameInfo): boolean {
  return gameIsFreeToPlay(game);
}

export function isFreePlayGameOwned(game: GameInfo): boolean {
  return gameIsOwnedByAccount(game);
}

/**
 * Free titles worth surfacing, newest-in-library last. Owned entries are kept
 * by default: seeing "無料" next to a title you already added is how the row
 * explains itself, and dropping them would make it flicker on add.
 */
export function collectFreeGames(
  games: readonly GameInfo[],
  options: { includeOwned?: boolean } = {},
): GameInfo[] {
  const includeOwned = options.includeOwned ?? true;
  const seen = new Set<string>();
  const result: GameInfo[] = [];

  for (const game of games) {
    if (!game.id || seen.has(game.id)) continue;
    if (!isFreePlayGame(game)) continue;
    if (!includeOwned && isFreePlayGameOwned(game)) continue;
    seen.add(game.id);
    result.push(game);
  }

  return result;
}

/**
 * A free title the account could add to its GFN library right now. Titles the
 * membership tier gates out are excluded: adding them would not make them
 * launchable, so the button would be a promise the launch cannot keep.
 *
 * `access` is the map the pages already build (`buildGameAccessMap`); without
 * it only the ownership rule is applied, which is the safe direction — the
 * button still works for titles the launch would refuse for a tier reason,
 * and `handleMarkGameOwned` reports that failure with its own notice.
 */
export function freeGamesNotInLibrary(
  games: readonly GameInfo[],
  access?: ReadonlyMap<string, GameAccess>,
): GameInfo[] {
  return collectFreeGames(games, { includeOwned: false })
    .filter((game) => access?.get(game.id)?.state !== "tier-required");
}

/** True when "ライブラリに追加" should be offered for this title. */
export function canAddFreeGameToLibrary(game: GameInfo, access?: GameAccess): boolean {
  if (access?.state === "tier-required") return false;
  return isFreePlayGame(game) && !isFreePlayGameOwned(game);
}
