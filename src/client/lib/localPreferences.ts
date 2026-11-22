import type { GameInfo } from "@shared/gfn";

import type { PlaytimeData } from "./gameCatalog";
import { gameActivityMs } from "./playtimeStore";

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
/**
 * Newest activity signal for a game (local tracker or catalog).
 *
 * Delegates to `playtimeStore.gameActivityMs` so the rail, the hero and the
 * library all agree on "last played" — they previously used different sources
 * and could show "3日前" next to "未プレイ" for the same game.
 */
export function gameActivityTimestamp(game: GameInfo, playtime: PlaytimeData): number {
  return gameActivityMs(game, playtime);
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
    return compareGameTitles(left.game.title, right.game.title);
  });
}

/**
 * Locale-aware title ordering for the rail and the palette.
 *
 * A bare `localeCompare` uses the runtime default locale, so the same catalog
 * can order "Ångström" before/after "Zebra" depending on the browser's OS
 * language — and the rail and the grid would then disagree. Pinning the
 * comparison to the active UI language keeps every list consistent, and
 * `sensitivity: "base"` keeps the order stable across platforms.
 */
export function compareGameTitles(left: string, right: string): number {
  const locale = typeof document !== "undefined" && document.documentElement.lang
    ? document.documentElement.lang
    : undefined;
  try {
    return left.localeCompare(right, locale, { sensitivity: "base", numeric: true });
  } catch {
    return left.localeCompare(right);
  }
}

/**
 * Human readable total playtime.
 *
 * The unit words come from the caller (`t("app.units.hours")` etc.) instead of
 * being baked in as "h"/"min": the rail and the library used to render the
 * desktop client's compact English units on an otherwise Japanese page, which
 * read as "4 min" right next to "2日前". Formatting stays here, wording does not.
 */
export function formatTotalPlaytime(
  totalSeconds: number,
  neverLabel = "未プレイ",
  units: PlaytimeUnitLabels = DEFAULT_PLAYTIME_UNITS,
): string {
  const seconds = toNonNegativeNumber(totalSeconds);
  if (seconds <= 0) return neverLabel;
  if (seconds < 60) return units.lessThanMinute;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return units.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? units.hours(hours) : units.hoursMinutes(hours, remainingMinutes);
}

/** Unit wording for {@link formatTotalPlaytime}; injected so it can be translated. */
export interface PlaytimeUnitLabels {
  lessThanMinute: string;
  minutes(minutes: number): string;
  hours(hours: number): string;
  hoursMinutes(hours: number, minutes: number): string;
}

const DEFAULT_PLAYTIME_UNITS: PlaytimeUnitLabels = {
  lessThanMinute: "< 1 min",
  minutes: (minutes) => `${minutes} min`,
  hours: (hours) => `${hours} h`,
  hoursMinutes: (hours, minutes) => `${hours} h ${minutes} min`,
};

/**
 * Build the playtime units from the active translations.
 *
 * `t` is passed in rather than imported so this module stays DOM/React free
 * (the library page and the rail both call it during render).
 */
export function playtimeUnits(t: (key: string, values?: Record<string, string | number>) => string): PlaytimeUnitLabels {
  return {
    lessThanMinute: t("app.units.lessThanMinute"),
    minutes: (minutes) => t("app.units.minutes", { value: minutes }),
    hours: (hours) => t("app.units.hours", { value: hours }),
    hoursMinutes: (hours, minutes) => t("app.units.hoursMinutes", { value: hours, minutes }),
  };
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
    return compareGameTitles(left.title, right.title);
  });
}
