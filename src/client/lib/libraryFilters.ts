import type { GameInfo } from "@shared/gfn";
import { getStoreDisplayName, normalizeStoreKey } from "../components/GameCard";
import { controlLabel, playTypeFilterLabel } from "./gfnLabels";
import type { PlaytimeData } from "./gameCatalog";

export interface LibraryFilterOption {
  id: string;
  label: string;
  count: number;
}

export interface LibraryFilterGroup {
  id: string;
  label: string;
  options: LibraryFilterOption[];
}

export type LibraryTranslation = (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string;

function normalizeLibraryFilterValue(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getGameCatalogSkuText(game: GameInfo): string {
  const values = Object.values(game.catalogSkuStrings ?? {});
  const parts: string[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      parts.push(value);
    } else if (Array.isArray(value)) {
      parts.push(...value.filter((item): item is string => typeof item === "string"));
    }
  }
  return parts.join(" ");
}

function gameRequiresInstallToPlay(game: GameInfo): boolean {
  const haystack = [
    game.playType,
    game.playabilityState,
    ...(game.featureLabels ?? []),
    getGameCatalogSkuText(game),
  ].join(" ").toLowerCase();
  return haystack.includes("install");
}

function getGamePlayTypeFilter(game: GameInfo, t: LibraryTranslation): LibraryFilterOption | null {
  if (gameRequiresInstallToPlay(game)) {
    return { id: "play:install-to-play", label: t("library.filterOptions.installToPlay"), count: 0 };
  }
  if (!game.playType?.trim()) return null;
  const normalized = normalizeLibraryFilterValue(game.playType);
  if (!normalized) return null;
  if (normalized.includes("instant") || normalized.includes("stream") || normalized.includes("cloud")) {
    return { id: "play:cloud-launch", label: t("library.filterOptions.cloudLaunch"), count: 0 };
  }
  // `FREE_TO_PLAY` used to be title-cased into "Free To Play" and shown as-is.
  // The filter id must stay derived from the API value, not the label: the label
  // is now Japanese, and a Japanese label normalizes to an empty key.
  const label = playTypeFilterLabel(game.playType, t);
  return label ? { id: `play:${normalized}`, label, count: 0 } : null;
}

function getGameStoreFilters(game: GameInfo, t: LibraryTranslation): Array<{ id: string; label: string }> {
  const stores = game.availableStores?.length ? game.availableStores : game.variants.map((variant) => variant.store);
  const seen = new Set<string>();
  const filters: Array<{ id: string; label: string }> = [];
  for (const store of stores) {
    if (!store || !store.trim()) continue;
    const key = normalizeStoreKey(store);
    if (seen.has(key)) continue;
    seen.add(key);
    filters.push({ id: `platform:${key}`, label: getStoreDisplayName(store, t) });
  }
  return filters;
}

function getControlFilter(control: string, t: LibraryTranslation): { id: string; label: string } | null {
  const normalized = normalizeLibraryFilterValue(control);
  if (!normalized) return null;
  if (normalized.includes("keyboard") || normalized.includes("mouse")) {
    return { id: "controls:keyboard-mouse", label: t("library.filterOptions.keyboardMouse") };
  }
  if (normalized.includes("gamepad") || normalized.includes("controller")) {
    return { id: "controls:controller", label: t("library.filterOptions.controller") };
  }
  if (normalized.includes("touch")) {
    return { id: "controls:touch", label: t("library.filterOptions.touch") };
  }
  // Unrecognised control strings are dropped rather than title-cased into
  // English chip labels. The id keeps following the API value so switching the
  // UI language never changes which filter a chip matches.
  const label = controlLabel(control, t);
  return label ? { id: `controls:${normalized}`, label } : null;
}

function getGameControlFilters(game: GameInfo, t: LibraryTranslation): Array<{ id: string; label: string }> {
  const controls = [
    ...(game.supportedControls ?? []),
    ...(game.variants ?? []).flatMap((variant) => variant.supportedControls ?? []),
  ];
  const seen = new Set<string>();
  const filters: Array<{ id: string; label: string }> = [];
  for (const control of controls) {
    const filter = getControlFilter(control, t);
    if (!filter || seen.has(filter.id)) continue;
    seen.add(filter.id);
    filters.push(filter);
  }
  return filters;
}

function upsertLibraryFilterOption(options: Map<string, LibraryFilterOption>, id: string, label: string): void {
  const existing = options.get(id);
  if (existing) {
    existing.count += 1;
    return;
  }
  options.set(id, { id, label, count: 1 });
}

function mapLibraryFilterOptions(options: Map<string, LibraryFilterOption>): LibraryFilterOption[] {
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function gameHasLibraryActivity(game: GameInfo, playtimeData: PlaytimeData): boolean {
  if (game.lastPlayed) return true;
  const record = playtimeData[game.id];
  if (!record) return false;
  return Boolean(record.lastPlayedAt) || (record.totalSeconds ?? 0) > 0 || (record.sessionCount ?? 0) > 0;
}

export const FAVORITE_ACTIVITY_FILTER_ID = "activity:favorite";
/** Matches every game: the desktop Library's "All" chip. */
export const QUICK_ALL_FILTER_ID = "quick:all";
export const CONTROLLER_QUICK_FILTER_ID = "controls:controller";
export const READY_TO_PLAY_FILTER_ID = "ready:ready";
export const RTX_FILTER_ID = "feature:rtx";

/**
 * "Ready to play" mirrors the desktop Library's filter: the game itself is
 * playable and at least one variant can actually be launched right now.
 * `playabilityState` alone is not enough — a game can be PLAYABLE while every
 * variant is in maintenance.
 */
export function isGameReadyToPlay(game: GameInfo): boolean {
  if (game.playabilityState && game.playabilityState.toUpperCase() !== "PLAYABLE") return false;
  // `gfnStatus` is the only per-variant availability signal the catalog ships;
  // an empty list counts as "assume launchable" so a sparse payload does not
  // hide the whole library.
  const variants = game.variants ?? [];
  if (variants.length === 0) return true;
  return variants.some((variant) => (variant.gfnStatus ?? "").toUpperCase() === "AVAILABLE");
}

/** RTX support comes from NVIDIA's own tech tags, not from a store string. */
export function gameSupportsRtx(game: GameInfo): boolean {
  const tags = [...(game.nvidiaTech ?? []), ...(game.featureLabels ?? [])].map((tag) => tag.toUpperCase());
  return tags.some((tag) => tag.includes("RTX"));
}

export function gameSupportsController(game: GameInfo): boolean {
  const controls = [
    ...(game.supportedControls ?? []),
    ...(game.variants ?? []).flatMap((variant) => variant.supportedControls ?? []),
  ].join(" ").toLowerCase();
  return controls.includes("gamepad") || controls.includes("controller");
}

export function getLibraryFilterGroups(
  games: GameInfo[],
  playtimeData: PlaytimeData,
  t: LibraryTranslation,
  favoriteIds: readonly string[] = [],
  /** games.length is the total library size; `games` may already be filtered. */
  totalLibraryCount?: number,
): LibraryFilterGroup[] {
  const playTypeOptions = new Map<string, LibraryFilterOption>();
  const platformOptions = new Map<string, LibraryFilterOption>();
  const controlOptions = new Map<string, LibraryFilterOption>();
  const activityOptions = new Map<string, LibraryFilterOption>();

  const favorites = new Set(favoriteIds);
  const favoriteCount = favoriteIds.length > 0
    ? games.filter((game) => favorites.has(game.id)).length
    : 0;
  if (favoriteCount > 0) {
    activityOptions.set(FAVORITE_ACTIVITY_FILTER_ID, {
      id: FAVORITE_ACTIVITY_FILTER_ID,
      label: t("library.filterOptions.favorite"),
      count: favoriteCount,
    });
  }

  for (const game of games) {
    const playTypeOption = getGamePlayTypeFilter(game, t);
    if (playTypeOption) upsertLibraryFilterOption(playTypeOptions, playTypeOption.id, playTypeOption.label);

    for (const option of getGameStoreFilters(game, t)) {
      upsertLibraryFilterOption(platformOptions, option.id, option.label);
    }

    for (const option of getGameControlFilters(game, t)) {
      upsertLibraryFilterOption(controlOptions, option.id, option.label);
    }

    const hasActivity = gameHasLibraryActivity(game, playtimeData);
    upsertLibraryFilterOption(
      activityOptions,
      hasActivity ? "activity:played" : "activity:never-played",
      hasActivity ? t("library.filterOptions.played") : t("library.filterOptions.neverPlayed"),
    );
  }

  // Quick filters from the desktop Library: the first row is a flat set of
  // counts (All / Ready to play / RTX / Controller / stores) rather than a
  // dropdown, so the most common cuts are one click away.
  const quickOptions: LibraryFilterOption[] = [
    {
      id: QUICK_ALL_FILTER_ID,
      label: t("library.filterOptions.all"),
      count: totalLibraryCount ?? games.length,
    },
  ];
  const readyCount = games.filter((game) => isGameReadyToPlay(game)).length;
  if (readyCount > 0) {
    quickOptions.push({ id: READY_TO_PLAY_FILTER_ID, label: t("library.filterOptions.readyToPlay"), count: readyCount });
  }
  const rtxCount = games.filter((game) => gameSupportsRtx(game)).length;
  if (rtxCount > 0) {
    quickOptions.push({ id: RTX_FILTER_ID, label: t("library.filterOptions.rtx"), count: rtxCount });
  }
  const controllerCount = games.filter((game) => gameSupportsController(game)).length;
  if (controllerCount > 0) {
    quickOptions.push({
      id: CONTROLLER_QUICK_FILTER_ID,
      label: t("library.filterOptions.controller"),
      count: controllerCount,
    });
  }
  for (const option of mapLibraryFilterOptions(platformOptions)) {
    quickOptions.push(option);
  }

  return [
    { id: "quick", label: t("library.filterGroups.quick"), options: quickOptions },
    { id: "play", label: t("library.filterGroups.playType"), options: mapLibraryFilterOptions(playTypeOptions) },
    { id: "platform", label: t("library.filterGroups.platform"), options: mapLibraryFilterOptions(platformOptions) },
    { id: "controls", label: t("library.filterGroups.controls"), options: mapLibraryFilterOptions(controlOptions) },
    { id: "activity", label: t("library.filterGroups.activity"), options: mapLibraryFilterOptions(activityOptions) },
  ].filter((group) => group.options.length > 0);
}

function getLibraryFilterGroupId(filterId: string): string {
  const separatorIndex = filterId.indexOf(":");
  return separatorIndex >= 0 ? filterId.slice(0, separatorIndex) : filterId;
}

export function gameMatchesLibraryFilter(
  game: GameInfo,
  filterId: string,
  playtimeData: PlaytimeData,
  t: LibraryTranslation,
  favoriteIds: readonly string[] = [],
): boolean {
  const [groupId, value] = filterId.split(":");
  if (!value) return true;

  if (groupId === "quick") {
    // `all` is the neutral chip: it never narrows the grid.
    return true;
  }

  if (filterId === READY_TO_PLAY_FILTER_ID) {
    return isGameReadyToPlay(game);
  }

  if (filterId === RTX_FILTER_ID) {
    return gameSupportsRtx(game);
  }

  if (groupId === "play") {
    return getGamePlayTypeFilter(game, t)?.id === filterId;
  }

  if (groupId === "platform") {
    return getGameStoreFilters(game, t).some((option) => option.id === filterId);
  }

  if (groupId === "controls") {
    return getGameControlFilters(game, t).some((option) => option.id === filterId);
  }

  if (groupId === "activity") {
    if (value === "favorite") return favoriteIds.includes(game.id);
    const hasActivity = gameHasLibraryActivity(game, playtimeData);
    return value === "played" ? hasActivity : !hasActivity;
  }

  return true;
}

export function gameMatchesLibraryFilters(
  game: GameInfo,
  selectedFilterIds: string[],
  playtimeData: PlaytimeData,
  t: LibraryTranslation,
  favoriteIds: readonly string[] = [],
): boolean {
  if (selectedFilterIds.length === 0) return true;
  const selectedByGroup = new Map<string, string[]>();
  for (const filterId of selectedFilterIds) {
    const groupId = getLibraryFilterGroupId(filterId);
    selectedByGroup.set(groupId, [...(selectedByGroup.get(groupId) ?? []), filterId]);
  }
  for (const groupFilterIds of selectedByGroup.values()) {
    if (!groupFilterIds.some((filterId) => gameMatchesLibraryFilter(game, filterId, playtimeData, t, favoriteIds))) return false;
  }
  return true;
}

export function getLibraryFilterOptionById(groups: LibraryFilterGroup[], id: string): LibraryFilterOption | undefined {
  for (const group of groups) {
    const option = group.options.find((candidate) => candidate.id === id);
    if (option) return option;
  }
  return undefined;
}

export interface ControllerStoreFilterItem {
  id: string;
  title: string;
}

export function gameMatchesStoreFilter(game: GameInfo, filterId: string): boolean {
  if (filterId === "library") return true;
  const store = filterId.slice("store:".length);
  return (game.variants ?? []).some((variant) => variant.store === store) || (game.availableStores ?? []).includes(store);
}

export function getControllerStoreFilterItems(
  games: GameInfo[],
  allStoresLabel: string,
  t: LibraryTranslation,
): ControllerStoreFilterItem[] {
  const stores = new Set<string>();
  for (const game of games) {
    for (const store of game.availableStores ?? []) {
      if (store?.trim()) stores.add(store);
    }
    for (const variant of game.variants ?? []) {
      if (variant.store?.trim()) stores.add(variant.store);
    }
  }

  return [
    { id: "library", title: allStoresLabel },
    // The chips used to print the raw store key, so an unrecognised store showed
    // as `Unknown` here too.
    ...[...stores]
      .sort((left, right) => left.localeCompare(right))
      .map((store) => ({ id: `store:${store}`, title: getStoreDisplayName(store, t) })),
  ];
}
