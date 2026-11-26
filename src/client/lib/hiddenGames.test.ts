import { describe, expect, it } from "vitest";

import {
  HIDDEN_FILTER_ID,
  filterHiddenGames,
  isGameHidden,
  toHiddenIdSet,
  toggleHiddenGameId,
} from "./hiddenGames";

/**
 * "Hide from library" mirrors the desktop Library: hidden ids live in settings,
 * hidden games leave the grid (and the command palette) and come back through
 * the Hidden chip. These lock the rules down.
 */
describe("hidden games", () => {
  const games = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("toggles ids without losing order or duplicating", () => {
    expect(toggleHiddenGameId([], "a")).toEqual(["a"]);
    expect(toggleHiddenGameId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleHiddenGameId(["a", "b"], "a")).toEqual(["b"]);
    // A corrupt/hand-edited setting must not reintroduce junk ids.
    expect(toggleHiddenGameId(["", "  ", "a"], "b")).toEqual(["a", "b"]);
    expect(toggleHiddenGameId(undefined, "a")).toEqual(["a"]);
  });

  it("hides games from the normal grid and shows them under the chip", () => {
    expect(filterHiddenGames(games, ["b"]).map((game) => game.id)).toEqual(["a", "c"]);
    expect(filterHiddenGames(games, ["b"], true).map((game) => game.id)).toEqual(["b"]);
    // Nothing hidden: the chip would be empty, so the caller hides it.
    expect(filterHiddenGames(games, [], true)).toEqual([]);
  });

  it("answers membership questions defensively", () => {
    expect(isGameHidden({ id: "b" }, ["b"])).toBe(true);
    expect(isGameHidden({ id: "a" }, ["b"])).toBe(false);
    expect(isGameHidden(null, ["b"])).toBe(false);
    expect(toHiddenIdSet(undefined).size).toBe(0);
  });

  it("uses a namespaced filter id so it cannot collide with a catalog filter", () => {
    expect(HIDDEN_FILTER_ID).toBe("visibility:hidden");
  });
});
