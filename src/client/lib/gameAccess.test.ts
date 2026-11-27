import { describe, expect, it } from "vitest";

import type { GameInfo, GameVariant } from "@shared/gfn";

import {
  buildGameAccessMap,
  gameIsFreeToPlay,
  gameIsOwnedByAccount,
  isGameLockedForAccount,
  normalizeAccountTier,
  requiredTierForGame,
  resolveGameAccess,
  tierSatisfies,
} from "./gameAccess";

/**
 * GeForce NOW lists store entries the signed-in account cannot launch. The
 * desktop client keeps them visible and marks them (`gameLockedByMembership` in
 * `ShellStore.qml`, fed by the catalog's `minimumMembershipTierLabel`); the web
 * shell has to agree, otherwise every locked tile sends a launch that NVIDIA
 * rejects with `INSUFFICIENT_PLAYABILITY`.
 */

function variant(overrides: Partial<GameVariant> = {}): GameVariant {
  return { id: "v1", store: "STEAM", supportedControls: [], ...overrides };
}

function game(overrides: Partial<GameInfo> = {}): GameInfo {
  return {
    id: "1",
    title: "Test Game",
    selectedVariantIndex: 0,
    variants: [variant()],
    ...overrides,
  };
}

describe("ownership", () => {
  it("treats any owned variant as owned, regardless of which one is selected", () => {
    const catalogGame = game({
      variants: [
        variant({ id: "a", store: "STEAM" }),
        variant({ id: "b", store: "EPIC_GAMES_STORE", libraryStatus: "PLATFORM_SYNC" }),
      ],
    });
    expect(gameIsOwnedByAccount(catalogGame)).toBe(true);
    expect(resolveGameAccess(catalogGame, "FREE").state).toBe("ready");
  });

  it("reports a store entry nobody owns as not owned", () => {
    const access = resolveGameAccess(game(), "ULTIMATE");
    expect(access.state).toBe("not-owned");
    expect(isGameLockedForAccount(access)).toBe(true);
  });

  it("trusts the catalog-wide library flag", () => {
    expect(gameIsOwnedByAccount(game({ isInLibrary: true, variants: [] }))).toBe(true);
  });

  it("keeps free-to-play titles launchable without ownership", () => {
    const freeGame = game({ playType: "FREE_TO_PLAY" });
    expect(gameIsFreeToPlay(freeGame)).toBe(true);
    expect(resolveGameAccess(freeGame, "FREE").state).toBe("ready");
  });

  it("recognises free-to-play from the SKU text when playType is missing", () => {
    expect(gameIsFreeToPlay(game({ catalogSkuStrings: { SKU_BASED_TAG: ["FREE TO PLAY"] } }))).toBe(true);
    expect(gameIsFreeToPlay(game({ featureLabels: ["Free-To-Play"] }))).toBe(true);
    expect(gameIsFreeToPlay(game({ genres: ["Action"] }))).toBe(false);
  });
});

describe("membership tier gate", () => {
  const premiumGame = game({
    id: "p",
    membershipTierLabel: "Premium",
    variants: [variant({ libraryStatus: "IN_LIBRARY" })],
  });

  it("reads the minimum tier and ignores a Free label", () => {
    // `Premium` is NVIDIA's label for the Priority plan.
    expect(requiredTierForGame({ membershipTierLabel: "Premium" })).toBe("PRIORITY");
    expect(requiredTierForGame({ membershipTierLabel: "Ultimate" })).toBe("ULTIMATE");
    expect(requiredTierForGame({ membershipTierLabel: "Free" })).toBeNull();
    expect(requiredTierForGame({})).toBeNull();
  });

  it("ignores the gate for owned titles, which stay launchable", () => {
    expect(resolveGameAccess(premiumGame, "FREE").state).toBe("ready");
  });

  it("blocks a Free account on a gated title that is not owned", () => {
    const gated = game({ id: "g", membershipTierLabel: "Premium", variants: [variant()] });
    const access = resolveGameAccess(gated, "FREE");
    expect(access.state).toBe("tier-required");
    expect(access.tierLabel).toBe("Premium");
  });

  it("does not guess when the account tier is unknown", () => {
    const gated = game({ id: "g2", membershipTierLabel: "Premium", variants: [variant()] });
    // Unknown plan: the tier rule is skipped, the ownership rule still applies.
    expect(resolveGameAccess(gated, null).state).toBe("not-owned");
  });

  it("compares plans by rank", () => {
    expect(tierSatisfies("ULTIMATE", "PRIORITY")).toBe(true);
    expect(tierSatisfies("PRIORITY", "PRIORITY")).toBe(true);
    expect(tierSatisfies("FREE", "PRIORITY")).toBe(false);
    expect(tierSatisfies("ULTIMATE", "ULTIMATE")).toBe(true);
  });

  it("normalizes MES enums", () => {
    expect(normalizeAccountTier("ultimate")).toBe("ULTIMATE");
    expect(normalizeAccountTier("  ") ).toBeNull();
    expect(normalizeAccountTier(null)).toBeNull();
  });
});

describe("access map", () => {
  it("resolves every game once and defaults to ready when absent", () => {
    const games = [
      game({ id: "owned", isInLibrary: true }),
      game({ id: "locked", variants: [variant()] }),
    ];
    const map = buildGameAccessMap(games, "FREE");
    expect(map.get("owned")?.state).toBe("ready");
    expect(map.get("locked")?.state).toBe("not-owned");
    // Not in the map (e.g. a hero slide fetched separately) never blocks.
    expect(map.get("missing")).toBeUndefined();
  });
});
