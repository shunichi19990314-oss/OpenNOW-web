import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GameInfo } from "@shared/gfn";

import { HomePage } from "./HomePage";
import { GameDetailsModal } from "./GameDetailsModal";

import { buildGameAccessMap } from "../lib/gameAccess";
import { canAddFreeGameToLibrary, collectFreeGames, freeGamesNotInLibrary } from "../lib/freeGames";

import ja from "../../../locales/ja.json";

/**
 * Free-to-play titles are the one case where "get it here" is literal: there is
 * nothing to pay, so the shell can add the title to the account's GeForce NOW
 * library itself (`POST /api/mark-owned`). Paid titles stay a store hand-off.
 * These tests pin the split so the free path never degrades into a second
 * "open the store" button, and so it never claims a purchase happened.
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

const freeGame = game("free", { playType: "FREE_TO_PLAY" });
const freeOwned = game("free-owned", {
  playType: "FREE_TO_PLAY",
  isInLibrary: true,
  variants: [{ id: "v-free-owned", store: "STEAM", supportedControls: [], libraryStatus: "IN_LIBRARY" }],
});
const tierFreeGame = game("free-ultimate", { playType: "FREE_TO_PLAY", membershipTierLabel: "Ultimate" });
const paidGame = game("paid");

describe("free-to-play detection", () => {
  it("picks only free titles out of the catalogue, de-duplicated", () => {
    const picked = collectFreeGames([freeGame, paidGame, freeOwned, freeGame]);
    expect(picked.map((entry) => entry.id)).toEqual(["free", "free-owned"]);
  });

  it("separates titles already in the library", () => {
    expect(freeGamesNotInLibrary([freeGame, freeOwned]).map((entry) => entry.id)).toEqual(["free"]);
  });

  it("does not offer the add for a free title the tier gates out", () => {
    // Adding it would not make it launchable, so the button would be a lie.
    const access = buildGameAccessMap([tierFreeGame], "FREE");
    expect(canAddFreeGameToLibrary(tierFreeGame)).toBe(true);
    expect(canAddFreeGameToLibrary(tierFreeGame, access.get(tierFreeGame.id))).toBe(false);
    expect(freeGamesNotInLibrary([tierFreeGame], access)).toEqual([]);
  });

  it("never offers the add for a paid title", () => {
    expect(canAddFreeGameToLibrary(paidGame)).toBe(false);
  });
});

const baseModalProps = {
  isFavorite: false,
  onToggleFavorite: () => {},
  onPlay: () => {},
  onClose: () => {},
};

describe("details modal free-title action", () => {
  it("adds to the library in place, with copy that promises no purchase", () => {
    const markup = renderToStaticMarkup(
      <GameDetailsModal
        {...baseModalProps}
        game={freeGame}
        onAddToLibrary={() => {}}
      />,
    );
    expect(markup).toContain(ja.gameDetails.addToLibrary);
    expect(markup).toContain(ja.gameDetails.freeHint);
    // Still launchable: the add is an extra action, not a replacement.
    expect(markup).toContain(ja.app.actions.play);
    // Nothing about buying or opening a store for a free title.
    expect(markup).not.toContain(ja.gameDetails.buyHint);
  });

  it("shows the pending label and blocks a second click", () => {
    const markup = renderToStaticMarkup(
      <GameDetailsModal
        {...baseModalProps}
        game={freeGame}
        onAddToLibrary={() => {}}
        isAddPending
      />,
    );
    expect(markup).toContain(ja.gameDetails.addingToLibrary);
    expect(markup).toContain("disabled");
  });

  it("hides the add once the title is in the library", () => {
    const markup = renderToStaticMarkup(
      <GameDetailsModal {...baseModalProps} game={freeOwned} />,
    );
    // The free note quotes "ライブラリに追加" too, so assert on the button.
    expect(markup).not.toContain("game-details-add");
  });

  it("keeps the store hand-off for a paid title", () => {
    const markup = renderToStaticMarkup(
      <GameDetailsModal
        {...baseModalProps}
        game={paidGame}
        lockedReason={ja.gameCard.notOwnedHint}
        onBuy={() => {}}
      />,
    );
    expect(markup).toContain(ja.gameDetails.buyOnStore);
    expect(markup).not.toContain(ja.gameDetails.freeHint);
  });
});

function renderHome(games: GameInfo[], access = buildGameAccessMap(games, "FREE")): string {
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
      onMarkGameOwned={() => {}}
      gameAccess={access}
    />,
  );
}

describe("無料のゲーム shelf", () => {
  it("lifts addable free titles into their own row", () => {
    const markup = renderHome([freeGame, paidGame, freeOwned]);
    expect(markup).toContain(ja.home.freeGames.title);
    expect(markup).toContain(ja.home.freeGames.hint);
    expect(markup).toContain("home-free-row");
    // One add button — for the free title not yet in the library.
    const addButtons = markup.split("home-free-add").length - 1;
    expect(addButtons).toBe(1);
  });

  it("renders no row when nothing is addable", () => {
    const markup = renderHome([paidGame, freeOwned]);
    expect(markup).not.toContain(ja.home.freeGames.title);
  });

  it("renders no row when the library add is unavailable (signed out)", () => {
    const markup = renderToStaticMarkup(
      <HomePage
        games={[freeGame]}
        searchQuery=""
        onSearchChange={() => {}}
        onPlayGame={() => {}}
        favoriteGameIds={[]}
        onToggleFavorite={() => {}}
        isLoading={false}
        selectedGameId={freeGame.id}
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
        totalCount={1}
        supportedCount={1}
        gameAccess={buildGameAccessMap([freeGame], "FREE")}
      />,
    );
    // The row only exists to add things; without the action it is dead weight.
    expect(markup).not.toContain(ja.home.freeGames.title);
  });
});
