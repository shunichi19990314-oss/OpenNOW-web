import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { GameInfo } from "@shared/gfn";

import { GameCard } from "./GameCard";
import { GameDetailsModal } from "./GameDetailsModal";
import { HomePage } from "./HomePage";

/**
 * The reported leftovers were raw catalogue values, not JSX literals:
 * the hero chip printed `FREE_TO_PLAY` and cards under unrecognised stores read
 * `Unknown ストア`. A source scan cannot see either, so these tests render the
 * components with the exact payload GeForce NOW sends and inspect the markup.
 */

function game(id: string, title: string, extra: Partial<GameInfo> = {}): GameInfo {
  return {
    id,
    title,
    selectedVariantIndex: 0,
    variants: [],
    imageUrl: `https://example.invalid/${id}.jpg`,
    ...extra,
  };
}

/** `inferPublicGameStore` emits this literal when it cannot identify a store. */
const unknownStoreGame = game("2", "Mystery Title", {
  playType: "FREE_TO_PLAY",
  availableStores: ["Unknown"],
  variants: [{ id: "2", store: "Unknown", supportedControls: [], gfnStatus: "AVAILABLE" }],
});

const RAW_ENUM = /FREE_TO_PLAY|INSTALL_TO_PLAY|READY_TO_PLAY|UNKNOWN_STORE/;

function renderHome(games: GameInfo[], hero: GameInfo[]): string {
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
      storeHeroGames={hero}
    />,
  );
}

describe("catalogue enums never reach the rendered UI", () => {
  it("renders the hero chip in Japanese instead of FREE_TO_PLAY", () => {
    const markup = renderHome([unknownStoreGame], [unknownStoreGame]);
    expect(markup).toContain("home-hero-chip");
    expect(markup).not.toMatch(RAW_ENUM);
    // The free-to-play wording is used; it must not be conflated with the
    // "ready to play" label, which only says NVIDIA hosts the title.
    expect(markup).toContain("無料でプレイ");
  });

  it("renders an unknown store as Japanese, not `Unknown`", () => {
    const markup = renderHome([unknownStoreGame], [unknownStoreGame]);
    expect(markup).not.toContain("Unknown");
    expect(markup).toContain("不明");
  });

  it("keeps going when playType is missing", () => {
    const bare = game("3", "Bare Title");
    const markup = renderHome([bare], [bare]);
    expect(markup).not.toMatch(RAW_ENUM);
    // No genre, no store, no play type: the chip is omitted rather than filled
    // with an English placeholder such as "Cloud Game".
    expect(markup).not.toContain("Cloud Game");
  });

  it("renders the details modal kicker in Japanese", () => {
    const markup = renderToStaticMarkup(
      <GameDetailsModal
        game={game("4", "Install Me", { playType: "INSTALL_TO_PLAY", availableStores: ["Unknown"] })}
        isFavorite={false}
        onToggleFavorite={() => {}}
        onPlay={() => {}}
        onClose={() => {}}
      />,
    );
    expect(markup).toContain("game-details-kicker");
    expect(markup).not.toMatch(RAW_ENUM);
    expect(markup).toContain("インストールしてプレイ");
    expect(markup).not.toContain("Unknown");
  });

  it("renders catalogue genres and tech tags in Japanese", () => {
    const markup = renderToStaticMarkup(
      <GameDetailsModal
        game={game("5", "Tagged Title", {
          genres: ["Action", "アクション", "Whimsical Sandcastle Simulator"],
          nvidiaTech: ["PHOTO_MODE"],
          supportedControls: ["keyboard"],
        })}
        isFavorite={false}
        onToggleFavorite={() => {}}
        onPlay={() => {}}
        onClose={() => {}}
      />,
    );
    expect(markup).toContain("game-details-tags");
    expect(markup).toContain("アクション");
    expect(markup).toContain("フォトモード");
    // An English genre would slip past the JSX scanner, so assert its absence.
    expect(markup).not.toContain("Whimsical Sandcastle Simulator");
    expect(markup).not.toContain("PHOTO_MODE");
  });

  it("labels an unknown store on the card itself", () => {
    const markup = renderToStaticMarkup(
      <GameCard
        game={unknownStoreGame}
        isSelected={false}
        onPlay={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(markup).toContain("game-card-platform");
    expect(markup).not.toContain("Unknown");
    expect(markup).toContain("不明");
  });
});
