import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GameInfo } from "@shared/gfn";

import { GameCard } from "./GameCard";
import { HomePage } from "./HomePage";

import { buildGameAccessMap } from "../lib/gameAccess";

/**
 * The catalogue lists titles the signed-in account cannot launch. They stay
 * visible (desktop parity), but every surface has to say why instead of
 * offering a Play button that NVIDIA answers with `INSUFFICIENT_PLAYABILITY`.
 */

function game(id: string, extra: Partial<GameInfo> = {}): GameInfo {
  return {
    id,
    title: `Game ${id}`,
    selectedVariantIndex: 0,
    variants: [{ id: `v-${id}`, store: "STEAM", supportedControls: [] }],
    imageUrl: `https://example.invalid/${id}.jpg`,
    ...extra,
  };
}

const ownedGame = game("owned", {
  isInLibrary: true,
  variants: [{ id: "v-owned", store: "STEAM", supportedControls: [], libraryStatus: "IN_LIBRARY" }],
});
const unownedGame = game("unowned");
const tierGame = game("tier", {
  membershipTierLabel: "Ultimate",
});

const access = buildGameAccessMap([ownedGame, unownedGame, tierGame], "FREE");

function renderCard(target: GameInfo): string {
  return renderToStaticMarkup(
    <GameCard
      game={target}
      access={access.get(target.id)}
      onPlay={() => {}}
      onSelect={() => {}}
    />,
  );
}

function renderHome(games: GameInfo[], hideLockedGames: boolean): string {
  return renderToStaticMarkup(
    <HomePage
      games={games}
      searchQuery=""
      onSearchChange={() => {}}
      onPlayGame={() => {}}
      favoriteGameIds={[]}
      onToggleFavorite={() => {}}
      isLoading={false}
      selectedGameId={games[0]?.id ?? ""}
      onSelectGame={() => {}}
      selectedVariantByGameId={{}}
      onSelectGameVariant={() => {}}
      filterGroups={[]}
      selectedFilterIds={[]}
      onToggleFilter={() => {}}
      onClearFilters={() => {}}
      sortOptions={[]}
      selectedSortId="relevance"
      onSortChange={() => {}}
      totalCount={games.length}
      supportedCount={games.length}
      storeHeroGames={[ownedGame, unownedGame]}
      gameAccess={access}
      hideLockedGames={hideLockedGames}
    />,
  );
}

describe("unplayable games are labelled instead of launchable", () => {
  it("keeps the play button on a game the account owns", () => {
    const markup = renderCard(ownedGame);
    expect(markup).toContain("game-card-play-button");
    expect(markup).not.toContain("game-card-lock-badge");
  });

  it("replaces the play button with a \"not owned\" badge", () => {
    const markup = renderCard(unownedGame);
    expect(markup).not.toContain("game-card-play-button");
    expect(markup).toContain("game-card-lock-badge");
    expect(markup).toContain("未所有");
    expect(markup).toContain("game-card--locked");
  });

  it("names the membership tier a gated title needs", () => {
    const markup = renderCard(tierGame);
    expect(markup).toContain("game-card-lock-badge");
    expect(markup).toContain("Ultimate");
    expect(markup).not.toContain("game-card-play-button");
  });

  it("never renders raw enum values for the lock label", () => {
    const markup = `${renderCard(unownedGame)}${renderCard(tierGame)}`;
    expect(markup).not.toMatch(/NOT_OWNED|TIER_REQUIRED|PREMIUM/);
  });
});

describe("the shelf filter follows the setting", () => {
  it("keeps locked entries when the player left them on", () => {
    const markup = renderHome([ownedGame, unownedGame], false);
    expect(markup).toContain("Game unowned");
  });

  it("drops locked entries from the shelves when enabled", () => {
    const markup = renderHome([ownedGame], true);
    expect(markup).toContain("Game owned");
    // The featured hero is a separate list and is filtered by the same rule.
    expect(markup).not.toContain("Game unowned");
  });
});
