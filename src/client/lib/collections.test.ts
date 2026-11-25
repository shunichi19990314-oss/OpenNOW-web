import { describe, expect, it } from "vitest";

import type { GameInfo } from "@shared/gfn";

import {
  MAX_COLLECTIONS,
  MAX_COLLECTION_NAME_LENGTH,
  addGameToCollection,
  createCollection,
  deleteCollection,
  filterGamesByCollection,
  loadCollections,
  renameCollection,
  saveCollections,
  validateCollectionName,
} from "./collections";

function storageWith(value?: string): { getItem: (key: string) => string | null; setItem: (key: string, next: string) => void; written: string[] } {
  const written: string[] = [];
  return {
    written,
    getItem: () => value ?? null,
    setItem: (_key: string, next: string) => {
      written.push(next);
    },
  };
}

const game = (id: string): GameInfo => ({ id, title: id, selectedVariantIndex: 0, variants: [] });

describe("collections", () => {
  it("validates names the way the desktop dialog does", () => {
    const existing = [createCollection("Favourites", [], { id: "c1", now: 1 })!];
    expect(validateCollectionName("   ", existing)).toBe("missing");
    expect(validateCollectionName("favourites", existing)).toBe("duplicate");
    expect(validateCollectionName("Favourites", existing, "c1")).toBeNull();
    expect(validateCollectionName("x".repeat(MAX_COLLECTION_NAME_LENGTH + 1), existing)).toBe("tooLong");
    const many = Array.from({ length: MAX_COLLECTIONS }, (_, index) =>
      createCollection(`c${index}`, [], { id: `id${index}`, now: index })!);
    expect(validateCollectionName("one more", many)).toBe("limit");
  });

  it("creates, renames and deletes without mutating the input", () => {
    const created = createCollection("  Co-op   nights ", [], { id: "c1", now: 5 });
    expect(created).toMatchObject({ id: "c1", name: "Co-op nights", gameIds: [] });

    const list = [created!];
    const renamed = renameCollection(list, "c1", "Co-op");
    expect(renamed?.[0].name).toBe("Co-op");
    expect(list[0].name).toBe("Co-op nights");
    expect(renameCollection(list, "c1", "CO-OP Nights")).not.toBeNull();
    expect(deleteCollection(list, "c1")).toEqual([]);
  });

  it("keeps membership unique", () => {
    const list = [createCollection("Shelf", [], { id: "c1", now: 1, gameId: "g1" })!];
    expect(addGameToCollection(list, "c1", "g1")[0].gameIds).toEqual(["g1"]);
    expect(addGameToCollection(list, "c1", "g2")[0].gameIds).toEqual(["g1", "g2"]);
  });

  it("filters the grid to a collection and tolerates removed games", () => {
    const list = [createCollection("Shelf", [], { id: "c1", now: 1, gameId: "g1" })!];
    const withMissing = addGameToCollection(list, "c1", "gone");
    const games = [game("g1"), game("g2")];
    expect(filterGamesByCollection(games, withMissing[0]).map((entry) => entry.id)).toEqual(["g1"]);
    expect(filterGamesByCollection(games, null).map((entry) => entry.id)).toEqual(["g1", "g2"]);
  });

  it("drops corrupted storage instead of breaking the page", () => {
    expect(loadCollections(storageWith("not json"))).toEqual([]);
    expect(loadCollections(storageWith('{"nope":true}'))).toEqual([]);
    expect(loadCollections(storageWith('[{"id":"a","name":"Keep","gameIds":["g1","g1"]},{"id":"b","name":"keep"},{}]')))
      .toEqual([{ id: "a", name: "Keep", gameIds: ["g1"], createdAtMs: 0 }]);
  });

  it("round-trips through storage and survives a throwing quota", () => {
    const store = storageWith();
    saveCollections([createCollection("Shelf", [], { id: "c1", now: 1 })!], store);
    expect(store.written).toHaveLength(1);
    expect(() => saveCollections([], { getItem: () => null, setItem: () => { throw new Error("quota"); } })).not.toThrow();
  });
});
