import type { GameInfo, GameVariant } from "@shared/gfn";

/**
 * "Can this account play it?" — entitlement rules for catalogue cards.
 *
 * GeForce NOW ships two independent signals for a game that is listed but not
 * launchable by the signed-in account:
 *
 * 1. `membershipTierLabel` — the catalog's `minimumMembershipTierLabel`
 *    (desktop build: `requiresPaidMembership`). NVIDIA reports `Premium` today,
 *    so a Free account sees the title in the store but cannot launch it.
 * 2. Ownership — none of the variants is in the account's library, i.e. the
 *    game still has to be bought on Steam/Epic/…
 *
 * The desktop client keeps these titles visible and marks them (`gameLockedByMembership`
 * in `ShellStore.qml`); it never sends them to the launch flow. This module is
 * the same rule, resolved once and shared by the cards, the launch guard and
 * the shelf filters.
 *
 * Free-to-play titles are exempt from the ownership rule: they are launchable
 * without buying anything, and hiding them would empty the store.
 */

export type GameAccessState = "ready" | "not-owned" | "tier-required";

export interface GameAccess {
  state: GameAccessState;
  /** Tier the catalog requires, as reported by NVIDIA (`Premium`, `Ultimate` …). */
  tierLabel?: string;
}

function isOwnedVariant(variant: GameVariant): boolean {
  if (variant.inLibrary || variant.librarySelected) return true;
  const status = variant.libraryStatus?.trim().toUpperCase();
  return status === "MANUAL" || status === "PLATFORM_SYNC" || status === "IN_LIBRARY";
}

/**
 * A game counts as owned when the player already has it, whether or not the
 * selected store variant is the owned one — the launch flow switches to the
 * owned variant anyway.
 */
export function gameIsOwnedByAccount(
  game: Pick<GameInfo, "isInLibrary" | "variants">,
): boolean {
  if (game.isInLibrary) return true;
  return (game.variants ?? []).some(isOwnedVariant);
}

/** Normalized plan name; the MES/auth payloads are upper-case enums. */
export function normalizeAccountTier(tier: string | null | undefined): string | null {
  if (!tier) return null;
  const normalized = tier.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

/**
 * Free-to-play titles are playable without owning them. The catalog reports
 * this through `playType`; the feature/label text is a fallback for payloads
 * that only carry the marketing string.
 */
export function gameIsFreeToPlay(
  game: Pick<GameInfo, "playType" | "featureLabels" | "catalogSkuStrings" | "genres">,
): boolean {
  const playType = (game.playType ?? "").trim().toUpperCase();
  if (playType.includes("FREE")) return true;

  const haystack = [
    ...(game.featureLabels ?? []),
    ...(game.genres ?? []),
    ...Object.values(game.catalogSkuStrings ?? {}).flatMap((value) =>
      typeof value === "string" ? [value] : Array.isArray(value) ? value : [],
    ),
  ]
    .join(" ")
    .toUpperCase();
  // Feature labels arrive as `Free-To-Play`, SKU strings as `FREE TO PLAY`.
  const normalized = haystack.replace(/[^A-Z0-9]+/g, " ");
  return normalized.includes("FREE TO PLAY");
}

/**
 * The tier the catalog demands, normalized, or null when the game is open to
 * every plan. `Free`/`None` in `minimumMembershipTierLabel` means "no gate".
 */
export function requiredTierForGame(
  game: Pick<GameInfo, "membershipTierLabel">,
): string | null {
  const tier = normalizeAccountTier(game.membershipTierLabel);
  if (!tier) return null;
  if (tier === "FREE" || tier === "NONE" || tier === "STANDARD") return null;
  // Canonical plan name: the catalogue says `Premium`, the account payload says
  // `PRIORITY`; the rank table below owns the comparison.
  return CANONICAL_TIER[tier] ?? tier;
}

/**
 * Resolve the access state for one game.
 *
 * `accountTier` is the signed-in account's plan (`FREE`, `PRIORITY`,
 * `ULTIMATE` …). When it is unknown the tier gate is not applied: guessing
 * would either hide launchable games or promise a launch that fails.
 */
export function resolveGameAccess(
  game: Pick<
    GameInfo,
    "isInLibrary" | "variants" | "membershipTierLabel" | "playType" | "featureLabels" | "catalogSkuStrings" | "genres"
  >,
  accountTier: string | null | undefined,
): GameAccess {
  const requiredTier = requiredTierForGame(game);
  const tierLabel = game.membershipTierLabel?.trim() || undefined;
  const owned = gameIsOwnedByAccount(game);

  if (requiredTier) {
    const tier = normalizeAccountTier(accountTier);
    // An owned title stays launchable: NVIDIA does not gate library titles the
    // account already streamed before, and the launch itself is the referee.
    if (!owned && tier !== null && !tierSatisfies(tier, requiredTier)) {
      return { state: "tier-required", tierLabel };
    }
  }

  if (!owned && !gameIsFreeToPlay(game)) {
    return { state: "not-owned", tierLabel };
  }

  return { state: "ready", tierLabel };
}

/** Plan names the catalog and the MES payload spell differently. */
const CANONICAL_TIER: Record<string, string> = {
  PREMIUM: "PRIORITY",
  PERFORMANCE: "PRIORITY",
};

const TIER_RANK: Record<string, number> = {
  FREE: 0,
  PRIORITY: 1,
  PERFORMANCE: 1,
  ULTIMATE: 2,
};

/** Does `accountTier` meet `requiredTier`? Unknown plans only match exactly. */
export function tierSatisfies(accountTier: string, requiredTier: string): boolean {
  const accountRank = TIER_RANK[accountTier];
  const requiredRank = TIER_RANK[requiredTier];
  if (accountRank === undefined || requiredRank === undefined) {
    return accountTier === requiredTier;
  }
  return accountRank >= requiredRank;
}

/** True when the card must not start a launch (it is still shown, labelled). */
export function isGameLockedForAccount(access: GameAccess): boolean {
  return access.state !== "ready";
}

/** Cached per-game access map, so list rendering stays O(1) per card. */
export type GameAccessMap = ReadonlyMap<string, GameAccess>;

export function buildGameAccessMap(
  games: readonly Pick<
    GameInfo,
    "id" | "isInLibrary" | "variants" | "membershipTierLabel" | "playType" | "featureLabels" | "catalogSkuStrings" | "genres"
  >[],
  accountTier: string | null | undefined,
): GameAccessMap {
  const map = new Map<string, GameAccess>();
  for (const game of games) {
    map.set(game.id, resolveGameAccess(game, accountTier));
  }
  return map;
}
