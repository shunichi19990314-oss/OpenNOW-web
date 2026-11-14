import { describe, expect, it } from "vitest";

import type { GameInfo } from "@shared/gfn";

import { gameMatchesLibraryFilters, getLibraryFilterGroups } from "./libraryFilters";
import { loadPlaytimeStore, summarizeRecentActivity, toggleFavoriteId } from "./localPreferences";

const t = (key: string) => key;

function game(id: string, overrides: Partial<GameInfo> = {}): GameInfo {
  return {
    id,
    title: `Game ${id}`,
    selectedVariantIndex: 0,
    variants: [{ id: `${id}-steam`, store: "STEAM", libraryStatus: "IN_LIBRARY", supportedControls: ["keyboard"] }],
    ...overrides,
  };
}

describe("gameMatchesLibraryFilters", () => {
  it("treats a matching favorite id as satisfied inside the activity group", () => {
    const games = [game("1"), game("2")];
    expect(gameMatchesLibraryFilters(games[0], ["activity:favorite"], {}, t, ["1"])).toBe(true);
    expect(gameMatchesLibraryFilters(games[1], ["activity:favorite"], {}, t, ["1"])).toBe(false);
  });

  it("matches every favorite when several are selected in the same group", () => {
    const candidate = game("1");
    expect(gameMatchesLibraryFilters(candidate, ["activity:favorite", "activity:played"], {}, t, ["1"])).toBe(true);
  });

  it("keeps non-favorite filter behavior unchanged without a favorite list", () => {
    const candidate = game("1");
    expect(gameMatchesLibraryFilters(candidate, ["activity:never-played"], {}, t)).toBe(true);
  });
});

describe("getLibraryFilterGroups with favorites", () => {
  it("adds a favorites option that counts matching games", () => {
    const games = [game("1"), game("2"), game("3")];
    const groups = getLibraryFilterGroups(games, {}, t, ["1", "3"]);
    const activity = groups.find((group) => group.id === "activity");
    const favorite = activity?.options.find((option) => option.id === "activity:favorite");
    expect(favorite?.count).toBe(2);
  });

  it("omits the favorites option when no games are favorited", () => {
    const groups = getLibraryFilterGroups([game("1")], {}, t, []);
    const activity = groups.find((group) => group.id === "activity");
    expect(activity?.options.some((option) => option.id === "activity:favorite") ?? false).toBe(false);
  });
});

describe("localPreferences", () => {
  it("toggles favorite ids without duplicates", () => {
    expect(toggleFavoriteId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleFavoriteId(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleFavoriteId([], "a")).toEqual(["a"]);
  });

  it("summarizes recent activity by most recent playtime first", () => {
    const summary = summarizeRecentActivity(
      [
        game("1", { lastPlayed: "2026-01-01T00:00:00.000Z" }),
        game("2"),
        game("3"),
      ],
      {
        "2": { totalSeconds: 0, lastPlayedAt: "2026-03-01T12:00:00.000Z", sessionCount: 2 },
        "3": { totalSeconds: 0, lastPlayedAt: "2026-02-01T12:00:00.000Z", sessionCount: 1 },
      },
    );
    expect(summary.map((entry) => entry.game.id)).toEqual(["2", "3", "1"]);
  });

  it("drops entries without any recorded activity", () => {
    expect(summarizeRecentActivity([game("1"), game("2")], {})).toEqual([]);
  });

  it("normalizes a corrupt playtime payload", () => {
    const storage = {
      getItem: () => "{not json",
    };
    expect(loadPlaytimeStore(storage)).toEqual({});
    expect(loadPlaytimeStore({ getItem: () => null })).toEqual({});
  });

  it("discards malformed playtime records", () => {
    const storage = {
      getItem: () => JSON.stringify({ a: { totalSeconds: "nope" }, b: { totalSeconds: 42, lastPlayedAt: "2026-01-01T00:00:00.000Z" } }),
    };
    const parsed = loadPlaytimeStore(storage);
    expect(parsed.a).toBeUndefined();
    expect(parsed.b?.totalSeconds).toBe(42);
  });
});
