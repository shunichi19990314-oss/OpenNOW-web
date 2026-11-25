import { describe, expect, it } from "vitest";

import type { GameInfo, GameVariant } from "@shared/gfn";

import {
  CONTROLLER_QUICK_FILTER_ID,
  QUICK_ALL_FILTER_ID,
  READY_TO_PLAY_FILTER_ID,
  RTX_FILTER_ID,
  gameMatchesLibraryFilters,
  gameSupportsController,
  gameSupportsRtx,
  getLibraryFilterGroups,
  isGameReadyToPlay,
} from "./libraryFilters";

const translate = (key: string): string => key;

function variant(overrides: Partial<GameVariant> = {}): GameVariant {
  return { id: "v1", store: "STEAM", supportedControls: ["keyboard", "mouse"], gfnStatus: "AVAILABLE", ...overrides };
}

function game(overrides: Partial<GameInfo> = {}): GameInfo {
  return {
    id: "g1",
    title: "Test game",
    selectedVariantIndex: 0,
    variants: [variant()],
    playabilityState: "PLAYABLE",
    ...overrides,
  };
}

/**
 * The desktop Library's quick filters ("Available versions", RTX, Controller)
 * were missing from the web library, which only had the dropdown. These guard
 * the predicates behind the new chip row.
 */
describe("library quick filters", () => {
  it("treats a PLAYABLE game with an AVAILABLE variant as ready", () => {
    expect(isGameReadyToPlay(game())).toBe(true);
  });

  it("rejects games whose variants are in maintenance or unplayable", () => {
    expect(isGameReadyToPlay(game({ variants: [variant({ gfnStatus: "MAINTENANCE" })] }))).toBe(false);
    expect(isGameReadyToPlay(game({ playabilityState: "NOT_PLAYABLE" }))).toBe(false);
  });

  it("reads RTX support from NVIDIA tech tags", () => {
    expect(gameSupportsRtx(game({ nvidiaTech: ["RTX_ON"] }))).toBe(true);
    expect(gameSupportsRtx(game({ featureLabels: ["RTX Ultimate"] }))).toBe(true);
    expect(gameSupportsRtx(game())).toBe(false);
  });

  it("detects controller support on the game or its variants", () => {
    expect(gameSupportsController(game({ supportedControls: ["gamepad"] }))).toBe(true);
    expect(gameSupportsController(game({ variants: [variant({ supportedControls: ["CONTROLLER"] })] }))).toBe(true);
    expect(gameSupportsController(game())).toBe(false);
  });

  it("counts the quick row and keeps All neutral", () => {
    const games = [
      game({ id: "a", nvidiaTech: ["RTX_ON"] }),
      game({ id: "b", variants: [variant({ gfnStatus: "MAINTENANCE" })] }),
    ];
    const quick = getLibraryFilterGroups(games, {}, translate).find((group) => group.id === "quick");
    const counts = new Map(quick?.options.map((option) => [option.id, option.count]));

    expect(counts.get(QUICK_ALL_FILTER_ID)).toBe(2);
    expect(counts.get(READY_TO_PLAY_FILTER_ID)).toBe(1);
    expect(counts.get(RTX_FILTER_ID)).toBe(1);
    // Neither game advertises gamepad support, so the chip is not offered.
    expect(counts.has(CONTROLLER_QUICK_FILTER_ID)).toBe(false);

    // "All" is a label change only; it must never hide games.
    expect(gameMatchesLibraryFilters(game(), [QUICK_ALL_FILTER_ID], {}, translate)).toBe(true);
    expect(gameMatchesLibraryFilters(games[1], [READY_TO_PLAY_FILTER_ID], {}, translate)).toBe(false);
    expect(gameMatchesLibraryFilters(games[0], [RTX_FILTER_ID], {}, translate)).toBe(true);
  });

  it("uses the total library size for the All chip", () => {
    const quick = getLibraryFilterGroups([game()], {}, translate, [], 42).find((group) => group.id === "quick");
    expect(quick?.options.find((option) => option.id === QUICK_ALL_FILTER_ID)?.count).toBe(42);
  });
});
