import type { GameInfo } from "@shared/gfn";

/**
 * User collections ("folders of your own") from the desktop Library
 * (`DesktopCollectionDialog.qml` / `ShellStore` collections API).
 *
 * The desktop build syncs them with the account. The web client has no such
 * endpoint, so they live in `localStorage` behind the same rules the desktop
 * enforces: a name is required, names are unique case-insensitively, the name
 * caps at 80 characters, and one account can hold at most 100 collections.
 * Everything here is pure so the dialog, the chips and the tests share it.
 */

export const COLLECTIONS_STORAGE_KEY = "opennow.collections.v1";
export const MAX_COLLECTIONS = 100;
export const MAX_COLLECTION_NAME_LENGTH = 80;

export interface GameCollection {
  id: string;
  name: string;
  gameIds: string[];
  createdAtMs: number;
}

export type CollectionNameError = "missing" | "tooLong" | "duplicate" | "limit";

export interface KeyValueStorageLike {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
}

function resolveStorage(explicit?: KeyValueStorageLike | null): KeyValueStorageLike | null {
  if (explicit) return explicit;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Safari private mode throws on property access.
    return null;
  }
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Case/space-insensitive comparison key; the displayed name keeps its case. */
export function collectionNameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase();
}

/**
 * Validate a candidate name. `collections` excludes the collection being
 * renamed, so renaming a folder to its own name is not a duplicate.
 */
export function validateCollectionName(
  name: string,
  collections: readonly GameCollection[],
  currentCollectionId?: string,
): CollectionNameError | null {
  const normalized = normalizeName(name);
  if (normalized.length === 0) return "missing";
  if ([...normalized].length > MAX_COLLECTION_NAME_LENGTH) return "tooLong";
  const key = collectionNameKey(normalized);
  const duplicate = collections.some(
    (collection) => collection.id !== currentCollectionId && collectionNameKey(collection.name) === key,
  );
  if (duplicate) return "duplicate";
  if (!currentCollectionId && collections.length >= MAX_COLLECTIONS) return "limit";
  return null;
}

function sanitizeEntry(value: unknown): GameCollection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<GameCollection>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  if (typeof record.name !== "string") return null;
  const name = normalizeName(record.name);
  if (name.length === 0) return null;
  const gameIds = Array.isArray(record.gameIds)
    ? record.gameIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return {
    id: record.id,
    name: name.slice(0, MAX_COLLECTION_NAME_LENGTH),
    // De-duplicate while keeping the order the visitor added them in.
    gameIds: [...new Set(gameIds)],
    createdAtMs: typeof record.createdAtMs === "number" && Number.isFinite(record.createdAtMs)
      ? record.createdAtMs
      : 0,
  };
}

export function loadCollections(storage?: KeyValueStorageLike | null): GameCollection[] {
  const target = resolveStorage(storage);
  if (!target) return [];
  let raw: string | null = null;
  try {
    raw = target.getItem(COLLECTIONS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const collections: GameCollection[] = [];
  for (const entry of parsed) {
    const collection = sanitizeEntry(entry);
    if (!collection || seenIds.has(collection.id)) continue;
    const key = collectionNameKey(collection.name);
    if (seenNames.has(key)) continue;
    seenIds.add(collection.id);
    seenNames.add(key);
    collections.push(collection);
  }
  return collections.slice(0, MAX_COLLECTIONS);
}

export function saveCollections(
  collections: readonly GameCollection[],
  storage?: KeyValueStorageLike | null,
): void {
  const target = resolveStorage(storage);
  if (!target?.setItem) return;
  try {
    target.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(collections));
  } catch {
    // Quota exceeded or a locked-down profile: collections stay in memory.
  }
}

export function createCollection(
  name: string,
  collections: readonly GameCollection[],
  options: { gameId?: string; now?: number; id?: string } = {},
): GameCollection | null {
  if (validateCollectionName(name, collections) !== null) return null;
  const id = options.id ?? `col-${(options.now ?? Date.now()).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: normalizeName(name),
    gameIds: options.gameId ? [options.gameId] : [],
    createdAtMs: options.now ?? Date.now(),
  };
}

export function renameCollection(
  collections: readonly GameCollection[],
  id: string,
  name: string,
): GameCollection[] | null {
  const target = collections.find((collection) => collection.id === id);
  if (!target) return null;
  if (validateCollectionName(name, collections, id) !== null) return null;
  return collections.map((collection) => (
    collection.id === id ? { ...collection, name: normalizeName(name) } : collection
  ));
}

export function deleteCollection(collections: readonly GameCollection[], id: string): GameCollection[] {
  return collections.filter((collection) => collection.id !== id);
}

export function addGameToCollection(
  collections: readonly GameCollection[],
  id: string,
  gameId: string,
): GameCollection[] {
  return collections.map((collection) => (
    collection.id === id && !collection.gameIds.includes(gameId)
      ? { ...collection, gameIds: [...collection.gameIds, gameId] }
      : collection
  ));
}

export function removeGameFromCollection(
  collections: readonly GameCollection[],
  id: string,
  gameId: string,
): GameCollection[] {
  return collections.map((collection) => (
    collection.id === id
      ? { ...collection, gameIds: collection.gameIds.filter((existing) => existing !== gameId) }
      : collection
  ));
}

/** Games of one collection in the catalog's order, dropping ids that vanished. */
export function filterGamesByCollection(
  games: readonly GameInfo[],
  collection: GameCollection | null | undefined,
): GameInfo[] {
  if (!collection) return [...games];
  const ids = new Set(collection.gameIds);
  return games.filter((game) => ids.has(game.id));
}
