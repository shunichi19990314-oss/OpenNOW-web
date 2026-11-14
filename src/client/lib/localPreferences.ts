import type { GameInfo } from "@shared/gfn";

import type { PlaytimeData } from "./gameCatalog";

/**
 * Small, dependency-free persistence + derivation helpers shared by the
 * convenience features (favorites toggle, "Continue playing" rail).
 *
 * Everything here is pure or storage-injectable so it can be unit tested
 * without a DOM, and every read is defensive: a corrupted or hand-edited
 * localStorage value must never break the app shell.
 */

export const FAVORITES_STORAGE_KEY = "opennow.favorites.v1";
export const PLAYTIME_STORAGE_KEY = "opennow:playtime";

/** Minimal `localStorage`-shaped surface; lets tests pass a stub. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
}

export interface PlaytimeRecord {
  totalSeconds: number;
  lastPlayedAt: string | null;
  sessionCount: number;
}

export type PlaytimeStore = Record<string, PlaytimeRecord>;

function resolveStorage(explicit?: KeyValueStorage | null): KeyValueStorage | null {
  if (explicit) return explicit;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Safari private mode can throw on property access.
    return null;
  }
}

function toNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function toIsoStringOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? value : null;
}

/** Toggle a favorite id, preserving insertion order for new ids. */
export function toggleFavoriteId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
}

/** Sort ids into a set for O(1) membership checks while rendering. */
export function toFavoriteSet(ids: readonly string[]): Set<string> {
  return new Set(ids.filter((id) => typeof id === "string" && id.length > 0));
}

export function loadPlaytimeStore(storage?: KeyValueStorage | null): PlaytimeStore {
  const target = resolveStorage(storage);
  if (!target) return {};
  let raw: string | null = null;
  try {
    raw = target.getItem(PLAYTIME_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const store: PlaytimeStore = {};
  for (const [gameId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Partial<PlaytimeRecord>;
    const totalSeconds = toNonNegativeNumber(record.totalSeconds);
    const sessionCount = toNonNegativeNumber(record.sessionCount);
    const lastPlayedAt = toIsoStringOrNull(record.lastPlayedAt);
    // Drop records that carry no usable information at all; they would only
    // show up as "played 0 m" rows.
    if (totalSeconds === 0 && sessionCount === 0 && lastPlayedAt === null) continue;
    store[gameId] = { totalSeconds, sessionCount, lastPlayedAt };
  }
  return store;
}

/** Absolute epoch ms of the newest activity signal we have for a game. */
export function gameActivityTimestamp(game: GameInfo, playtime: PlaytimeData): number {
  let newest = 0;
  const localLastPlayed = playtime[game.id]?.lastPlayedAt;
  if (localLastPlayed) {
    const ms = Date.parse(localLastPlayed);
    if (Number.isFinite(ms)) newest = Math.max(newest, ms);
  }
  if (game.lastPlayed) {
    const ms = Date.parse(game.lastPlayed);
    if (Number.isFinite(ms)) newest = Math.max(newest, ms);
  }
  for (const variant of game.variants ?? []) {
    if (!variant.lastPlayedDate) continue;
    const ms = Date.parse(variant.lastPlayedDate);
    if (Number.isFinite(ms)) newest = Math.max(newest, ms);
  }
  return newest;
}

export interface RecentActivityEntry {
  game: GameInfo;
  lastPlayedMs: number;
  totalSeconds: number;
  sessionCount: number;
}

/**
 * Games ordered by newest activity, newest first.
 *
 * Games without any local or catalog activity signal are excluded so the rail
 * never fills up with entries that only exist because the catalog listed them.
 */
export function summarizeRecentActivity(
  games: readonly GameInfo[],
  playtime: PlaytimeData,
): RecentActivityEntry[] {
  const entries: RecentActivityEntry[] = [];
  for (const game of games) {
    const lastPlayedMs = gameActivityTimestamp(game, playtime);
    const record = playtime[game.id];
    const totalSeconds = toNonNegativeNumber(record?.totalSeconds);
    const sessionCount = toNonNegativeNumber(record?.sessionCount);
    if (lastPlayedMs <= 0 && totalSeconds <= 0 && sessionCount <= 0) continue;
    entries.push({ game, lastPlayedMs, totalSeconds, sessionCount });
  }
  return entries.sort((left, right) => {
    if (left.lastPlayedMs !== right.lastPlayedMs) return right.lastPlayedMs - left.lastPlayedMs;
    if (left.totalSeconds !== right.totalSeconds) return right.totalSeconds - left.totalSeconds;
    return left.game.title.localeCompare(right.game.title);
  });
}

/** Human readable total playtime, matching the desktop client's compact style. */
export function formatTotalPlaytime(totalSeconds: number, neverLabel = "Never played"): string {
  const seconds = toNonNegativeNumber(totalSeconds);
  if (seconds <= 0) return neverLabel;
  if (seconds < 60) return "< 1 min";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`;
}

/** Rank games by relevance then recent activity, for the command palette. */
export function rankGamesForPalette(
  games: readonly GameInfo[],
  playtime: PlaytimeData,
  favoriteIds: readonly string[] = [],
): GameInfo[] {
  const favorites = toFavoriteSet(favoriteIds);
  const activity = new Map<string, number>();
  for (const game of games) {
    activity.set(game.id, gameActivityTimestamp(game, playtime));
  }
  return [...games].sort((left, right) => {
    const leftFavorite = favorites.has(left.id) ? 1 : 0;
    const rightFavorite = favorites.has(right.id) ? 1 : 0;
    if (leftFavorite !== rightFavorite) return rightFavorite - leftFavorite;
    const leftActivity = activity.get(left.id) ?? 0;
    const rightActivity = activity.get(right.id) ?? 0;
    if (leftActivity !== rightActivity) return rightActivity - leftActivity;
    return left.title.localeCompare(right.title);
  });
}
