import { describe, expect, it } from "vitest";

import type { GameInfo } from "@shared/gfn";

import ja from "../../../locales/ja.json";

import { buildCommandPaletteEntries } from "./commandPalette";

/**
 * The palette is a launcher, so a locked title stays in the corpus: running it
 * shows the reason (see the launch guard in `App.tsx`) instead of quietly doing
 * nothing. The hint has to say why, otherwise the entry looks like a normal
 * game that simply refuses to start.
 */

function game(id: string, title: string): GameInfo {
  return {
    id,
    title,
    selectedVariantIndex: 0,
    variants: [{ id: `v-${id}`, store: "STEAM", supportedControls: [] }],
  };
}

function t(key: string, values?: Record<string, string | number | boolean | null | undefined>): string {
  const raw = key
    .split(".")
    .reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), ja);
  if (typeof raw !== "string") return key;
  return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => String(values?.[name] ?? ""));
}

const baseContext = {
  games: [game("owned", "Owned Game"), game("locked", "Locked Game")],
  playtime: {},
  favoriteIds: [],
  canStream: false,
  isStreaming: false,
  pages: ["home"] as const,
};

describe("command palette hints", () => {
  it("marks a game the account cannot launch", () => {
    const entries = buildCommandPaletteEntries({ ...baseContext, lockedGameIds: ["locked"] }, t);
    const locked = entries.find((entry) => entry.id === "game:locked");
    const owned = entries.find((entry) => entry.id === "game:owned");
    expect(locked?.hint).toBe(ja.gameCard.notOwned);
    expect(owned?.hint).not.toBe(ja.gameCard.notOwned);
  });

  it("keeps the palette identical when nothing is locked", () => {
    const entries = buildCommandPaletteEntries(baseContext, t);
    expect(entries.find((entry) => entry.id === "game:locked")?.hint).not.toBe(ja.gameCard.notOwned);
  });
});
