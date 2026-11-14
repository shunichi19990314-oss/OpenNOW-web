import type { GameInfo } from "@shared/gfn";

import type { PlaytimeData } from "./gameCatalog";
import { rankGamesForPalette } from "./localPreferences";

/**
 * Command palette model.
 *
 * The palette is split into a pure "what can I run right now" builder and a
 * ranking filter, so the App only has to wire intent (open/close, run command)
 * and every list decision stays unit-testable.
 */

export type CommandPaletteKind = "game" | "page" | "stream" | "action";

export interface CommandPaletteEntry {
  id: string;
  kind: CommandPaletteKind;
  /** Localized group heading, e.g. "Navigate". */
  group: string;
  /** Localized primary label (the game title for game entries). */
  label: string;
  /** Localized secondary line; omitted when there is nothing useful to show. */
  hint?: string;
  /** Extra search tokens (never rendered) so "/" style aliases still match. */
  keywords: string[];
}

export interface CommandPaletteContext {
  games: readonly GameInfo[];
  playtime: PlaytimeData;
  favoriteIds: readonly string[];
  /** True when the current stream status allows stats/mic/etc. toggles. */
  canStream: boolean;
  /** True while a stream is actually running (stop/toggles make sense). */
  isStreaming: boolean;
  pages: ReadonlyArray<"home" | "library" | "settings">;
}

export type CommandPaletteTranslate = (
  key: string,
  values?: Record<string, string | number | boolean | null | undefined>,
) => string;

export const DEFAULT_GAME_LIMIT = 12;

const PAGE_ICON_KEYWORDS: Record<string, string[]> = {
  home: ["home", "store", "catalog", "ホーム", "ストア"],
  library: ["library", "collection", "owned", "ライブラリ"],
  settings: ["settings", "preferences", "options", "設定"],
};

/**
 * Build the ordered command list.
 *
 * Order is deliberate: games first (the palette's main job is launching), then
 * navigation, then in-stream toggles, then one-off actions. Within games,
 * favorites and recently played titles float to the top.
 */
export function buildCommandPaletteEntries(
  context: CommandPaletteContext,
  t: CommandPaletteTranslate,
  gameLimit: number = DEFAULT_GAME_LIMIT,
): CommandPaletteEntry[] {
  const entries: CommandPaletteEntry[] = [];
  const gameGroup = t("commandPalette.groups.games");
  const pageGroup = t("commandPalette.groups.navigate");
  const streamGroup = t("commandPalette.groups.stream");
  const actionGroup = t("commandPalette.groups.actions");

  const ranked = rankGamesForPalette(context.games, context.playtime, context.favoriteIds);
  const favorites = new Set(context.favoriteIds);
  for (const game of ranked.slice(0, Math.max(0, gameLimit))) {
    const lastPlayed = context.playtime[game.id]?.lastPlayedAt;
    const hintParts: string[] = [];
    if (favorites.has(game.id)) hintParts.push(t("commandPalette.hints.favorite"));
    if (lastPlayed) hintParts.push(t("commandPalette.hints.recent"));
    entries.push({
      id: `game:${game.id}`,
      kind: "game",
      group: gameGroup,
      label: game.title,
      hint: hintParts.length > 0 ? hintParts.join(" · ") : t("commandPalette.hints.play"),
      keywords: [game.title.toLowerCase(), t("commandPalette.keywords.play"), "play", "起動"],
    });
  }

  for (const page of context.pages) {
    entries.push({
      id: `page:${page}`,
      kind: "page",
      group: pageGroup,
      label: t(`commandPalette.pages.${page}`),
      keywords: PAGE_ICON_KEYWORDS[page] ?? [page],
    });
  }

  if (context.canStream) {
    const streamCommands: Array<{ id: string; labelKey: string; keywords: string[]; requiresStream?: boolean }> = [
      { id: "toggleStats", labelKey: "commandPalette.stream.toggleStats", keywords: ["stats", "fps", "統計"] },
      { id: "toggleMicrophone", labelKey: "commandPalette.stream.toggleMicrophone", keywords: ["mic", "voice", "マイク"], requiresStream: true },
      { id: "toggleFullscreen", labelKey: "commandPalette.stream.toggleFullscreen", keywords: ["fullscreen", "全画面"] },
      { id: "toggleAntiAfk", labelKey: "commandPalette.stream.toggleAntiAfk", keywords: ["afk", "idle", "離席"], requiresStream: true },
      { id: "stop", labelKey: "commandPalette.stream.stop", keywords: ["stop", "quit", "終了"], requiresStream: true },
    ];
    for (const command of streamCommands) {
      if (command.requiresStream && !context.isStreaming) continue;
      entries.push({
        id: `stream:${command.id}`,
        kind: "stream",
        group: streamGroup,
        label: t(command.labelKey),
        keywords: command.keywords,
      });
    }
  }

  if (context.isStreaming) {
    entries.push({
      id: "action:resumePointerLock",
      kind: "action",
      group: actionGroup,
      label: t("commandPalette.actions.captureMouse"),
      hint: t("commandPalette.actions.captureMouseHint"),
      keywords: ["mouse", "pointer", "capture", "マウス"],
    });
  }

  return entries;
}

function scoreEntry(entry: CommandPaletteEntry, query: string): number {
  const label = entry.label.toLowerCase();
  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (label.includes(query)) return 60;
  if (entry.keywords.some((keyword) => keyword.toLowerCase().startsWith(query))) return 40;
  if (entry.keywords.some((keyword) => keyword.toLowerCase().includes(query))) return 20;
  return 0;
}

/**
 * Rank entries for a query. An empty query keeps build order (which is already
 * meaningful), and the limit is applied after ranking so a match deep in the
 * list still surfaces.
 */
export function filterCommandPaletteEntries(
  entries: readonly CommandPaletteEntry[],
  query: string,
  limit = 40,
): CommandPaletteEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return entries.slice(0, limit);

  const scored = entries
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, normalized) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.index - right.index;
    });

  return scored.slice(0, limit).map((candidate) => candidate.entry);
}

/** Group entries for rendering, preserving first-seen group order. */
export function groupCommandPaletteEntries(
  entries: readonly CommandPaletteEntry[],
): Array<{ group: string; entries: CommandPaletteEntry[] }> {
  const order: string[] = [];
  const buckets = new Map<string, CommandPaletteEntry[]>();
  for (const entry of entries) {
    if (!buckets.has(entry.group)) {
      buckets.set(entry.group, []);
      order.push(entry.group);
    }
    buckets.get(entry.group)?.push(entry);
  }
  return order.map((group) => ({ group, entries: buckets.get(group) ?? [] }));
}
