import { describe, expect, it } from "vitest";

import type { GameInfo } from "@shared/gfn";

import { buildCommandPaletteEntries, filterCommandPaletteEntries, type CommandPaletteContext } from "./commandPalette";

function game(id: string, title: string): GameInfo {
  return { id, title, selectedVariantIndex: 0, variants: [] };
}

const t = (key: string, values?: Record<string, string | number | boolean | null | undefined>) => {
  const entries = Object.entries(values ?? {});
  return entries.length > 0 ? `${key}:${entries.map(([name, value]) => `${name}=${value}`).join(",")}` : key;
};

const baseContext: CommandPaletteContext = {
  games: [],
  playtime: {},
  favoriteIds: [],
  canStream: false,
  isStreaming: false,
  pages: ["home", "library"],
};

describe("buildCommandPaletteEntries", () => {
  it("lists navigation commands for the available pages", () => {
    const entries = buildCommandPaletteEntries(baseContext, t);
    const ids = entries.map((entry) => entry.id);
    expect(ids).toContain("page:home");
    expect(ids).toContain("page:library");
    expect(ids).not.toContain("page:settings");
  });

  it("adds stream commands only while a stream can be controlled", () => {
    const idleEntries = buildCommandPaletteEntries(baseContext, t);
    expect(idleEntries.some((entry) => entry.id === "stream:toggleStats")).toBe(false);

    const streamingEntries = buildCommandPaletteEntries(
      { ...baseContext, canStream: true, isStreaming: true },
      t,
    );
    const ids = streamingEntries.map((entry) => entry.id);
    expect(ids).toContain("stream:toggleStats");
    expect(ids).toContain("stream:toggleMicrophone");
    expect(ids).toContain("stream:toggleFullscreen");
    expect(ids).toContain("stream:toggleAntiAfk");
    expect(ids).toContain("stream:stop");
  });

  it("surfaces recently played games before other games", () => {
    const entries = buildCommandPaletteEntries(
      {
        ...baseContext,
        games: [game("1", "Alpha"), game("2", "Beta")],
        playtime: {
          "2": { totalSeconds: 0, lastPlayedAt: "2026-05-01T00:00:00.000Z", sessionCount: 1 },
        },
      },
      t,
    );
    const gameEntries = entries.filter((entry) => entry.kind === "game");
    expect(gameEntries.map((entry) => entry.id)).toEqual(["game:2", "game:1"]);
  });

  it("caps the number of listed games", () => {
    const games = Array.from({ length: 40 }, (_, index) => game(String(index), `Game ${index}`));
    const entries = buildCommandPaletteEntries({ ...baseContext, games }, t, 8);
    expect(entries.filter((entry) => entry.kind === "game")).toHaveLength(8);
  });

  it("exposes a keyboard hint for every command", () => {
    const entries = buildCommandPaletteEntries({ ...baseContext, canStream: true, isStreaming: true }, t);
    for (const entry of entries) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.group.length).toBeGreaterThan(0);
    }
  });
});

describe("filterCommandPaletteEntries", () => {
  const entries = buildCommandPaletteEntries(
    {
      ...baseContext,
      games: [game("1", "Cyberpunk 2077"), game("2", "Portal 2")],
    },
    t,
  );

  it("returns every entry in build order for an empty query", () => {
    expect(filterCommandPaletteEntries(entries, "", 100)).toHaveLength(entries.length);
  });

  it("matches game titles case-insensitively", () => {
    const matched = filterCommandPaletteEntries(entries, "cyber", 10);
    expect(matched.map((entry) => entry.id)).toEqual(["game:1"]);
  });

  it("matches keywords that are not in the label", () => {
    const palette = buildCommandPaletteEntries({ ...baseContext, pages: ["home", "library", "settings"] }, t);
    const matched = filterCommandPaletteEntries(palette, "settings", 10);
    expect(matched.some((entry) => entry.id === "page:settings")).toBe(true);
  });

  it("returns nothing for an unmatched query", () => {
    expect(filterCommandPaletteEntries(entries, "zzzzzz", 10)).toEqual([]);
  });

  it("keeps titles beyond the display limit searchable", () => {
    // The builder's limit is a corpus bound, not what gets rendered: capping at
    // the first 12 games made every other title unsearchable.
    const games = Array.from({ length: 120 }, (_, index) => game(String(index), `Title ${index}`));
    const entries = buildCommandPaletteEntries({ ...baseContext, games }, t, 120);
    const matched = filterCommandPaletteEntries(entries, "title 119", 10);
    expect(matched.map((entry) => entry.id)).toEqual(["game:119"]);
  });

  it("caps the corpus no matter what the caller asks for", () => {
    const games = Array.from({ length: 900 }, (_, index) => game(String(index), `Game ${index}`));
    const entries = buildCommandPaletteEntries({ ...baseContext, games }, t, 10_000);
    expect(entries.filter((entry) => entry.kind === "game").length).toBeLessThanOrEqual(300);
  });

  it("matches case-folded titles in non-ASCII scripts", () => {
    const entries = buildCommandPaletteEntries(
      { ...baseContext, games: [game("1", "Æther"), game("2", "Приключение")] },
      t,
    );
    expect(filterCommandPaletteEntries(entries, "æther", 10).map((entry) => entry.id)).toEqual(["game:1"]);
    expect(filterCommandPaletteEntries(entries, "приключение", 10).map((entry) => entry.id)).toEqual(["game:2"]);
  });
});
