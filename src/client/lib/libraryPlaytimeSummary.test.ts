import { describe, expect, it } from "vitest";

import type { GameInfo } from "@shared/gfn";

import { summarizeLibraryPlaytime } from "./libraryPlaytimeSummary";

/**
 * The summary line reads the same local tracker as the per-tile numbers, so the
 * two can never disagree. These cases cover the arithmetic and the payloads a
 * hand-edited storage blob can produce.
 */

function game(id: string, title = `Game ${id}`): GameInfo {
  return {
    id,
    title,
    selectedVariantIndex: 0,
    variants: [{ id: `v-${id}`, store: "STEAM", supportedControls: [] }],
  };
}

const games = [game("a", "Alpha"), game("b", "Beta"), game("c", "Gamma")];

describe("summarizeLibraryPlaytime", () => {
  it("adds totals, counts played games and sessions", () => {
    const summary = summarizeLibraryPlaytime(games, {
      a: { totalSeconds: 3600, sessionCount: 2 },
      b: { totalSeconds: 1800, sessionCount: 3 },
    });
    expect(summary.totalSeconds).toBe(5400);
    expect(summary.playedGames).toBe(2);
    expect(summary.games).toBe(3);
    expect(summary.sessions).toBe(5);
  });

  it("picks the most-played title", () => {
    const summary = summarizeLibraryPlaytime(games, {
      a: { totalSeconds: 600 },
      b: { totalSeconds: 7200 },
    });
    expect(summary.topGame?.id).toBe("b");
    expect(summary.topGameSeconds).toBe(7200);
  });

  it("breaks ties by list order so the line is stable", () => {
    const summary = summarizeLibraryPlaytime(games, {
      a: { totalSeconds: 900 },
      b: { totalSeconds: 900 },
    });
    expect(summary.topGame?.id).toBe("a");
  });

  it("ignores negative, NaN and missing records", () => {
    const summary = summarizeLibraryPlaytime(games, {
      a: { totalSeconds: -50 },
      b: { totalSeconds: Number.NaN },
      c: {},
    });
    expect(summary.totalSeconds).toBe(0);
    expect(summary.playedGames).toBe(0);
    expect(summary.topGame).toBeNull();
  });

  it("counts each game once even if the list repeats it", () => {
    const summary = summarizeLibraryPlaytime([...games, game("a")], {
      a: { totalSeconds: 60 },
      b: { totalSeconds: 30 },
    });
    expect(summary.games).toBe(3);
    expect(summary.totalSeconds).toBe(90);
  });

  it("reports zero for an empty library", () => {
    const summary = summarizeLibraryPlaytime([], {});
    expect(summary).toMatchObject({ totalSeconds: 0, playedGames: 0, games: 0, sessions: 0, topGame: null });
  });
});
