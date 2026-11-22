import { describe, expect, it } from "vitest";

import ja from "../../../locales/ja.json";
import { getStoreDisplayName } from "../components/GameCard";
import {
  controlLabel,
  isUnknownStore,
  playTypeLabel,
  playabilityStateLabel,
  unknownStoreLabel,
  type TranslateFn,
} from "./gfnLabels";

/**
 * The AST guard in `englishLeak.test.ts` only sees string literals that sit in
 * JSX text or in a `title`/`aria-label` attribute. Raw API enums never appear
 * there: they travel through helpers (`playTypeLabel`, `getStoreDisplayName`),
 * which is exactly how `FREE_TO_PLAY` and `Unknown` reached the screen while
 * every JSX text node was already Japanese. These tests call the helpers the way
 * the components do and assert the output, not the source.
 */

const read = (tree: Record<string, unknown>, key: string): unknown =>
  key.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    tree,
  );

/** Real ja.json lookup; a missing key returns the dotted key like the runtime does. */
const t: TranslateFn = (key) => (read(ja as unknown as Record<string, unknown>, key) as string) ?? key;

const JAPANESE = /[\u3040-\u30ff\u4e00-\u9fff]/;

describe("raw GeForce NOW enums are never printed verbatim", () => {
  it("translates every known playType", () => {
    expect(playTypeLabel("FREE_TO_PLAY", t)).toBe("無料でプレイ");
    expect(playTypeLabel("INSTALL_TO_PLAY", t)).toBe("インストールしてプレイ");
    expect(playTypeLabel("READY_TO_PLAY", t)).toBe("すぐにプレイ");
    // Free-to-play says the title costs nothing; ready-to-play only says NVIDIA
    // hosts it. Collapsing the two would change the meaning.
    expect(playTypeLabel("FREE_TO_PLAY", t)).not.toBe(playTypeLabel("READY_TO_PLAY", t));
  });

  it("never returns an upper-case enum token", () => {
    const values = [
      "FREE_TO_PLAY",
      "INSTALL_TO_PLAY",
      "READY_TO_PLAY",
      "PREMIUM",
      "SUBSCRIPTION",
      "SOME_FUTURE_ENUM",
      "free_to_play",
      "GameStream",
    ];
    for (const value of values) {
      const label = playTypeLabel(value, t);
      expect(label).not.toBeNull();
      expect(label).not.toMatch(/^[A-Z0-9_]+$/);
      expect(label).not.toContain("_");
    }
  });

  it("returns null for an empty playType so callers can omit the chip", () => {
    expect(playTypeLabel(undefined, t)).toBeNull();
    expect(playTypeLabel("   ", t)).toBeNull();
  });

  it("translates playability states and control names", () => {
    expect(playabilityStateLabel("PLAYABLE", t)).toBe("プレイ可能");
    expect(playabilityStateLabel("UNAVAILABLE", t)).toBe("利用不可");
    expect(playabilityStateLabel("MAINTENANCE", t)).toBe("メンテナンス中");
    expect(controlLabel("keyboard", t)).toBe("キーボード");
    expect(controlLabel("gamepad", t)).toBe("コントローラー");
    expect(controlLabel("touchscreen", t)).toBe("タッチ");
  });

  it("shows the server's unknown-store placeholder in Japanese", () => {
    // `inferPublicGameStore` returns the literal string "Unknown"; the card used
    // to prefix it into `Unknown ストア`.
    expect(isUnknownStore("Unknown")).toBe(true);
    expect(isUnknownStore("UNKNOWN")).toBe(true);
    expect(isUnknownStore(undefined)).toBe(true);
    expect(isUnknownStore("STEAM")).toBe(false);
    expect(unknownStoreLabel(t)).toMatch(JAPANESE);

    const unknown = getStoreDisplayName("Unknown", t);
    expect(unknown).toBe("不明");
    expect(unknown).not.toMatch(/[A-Za-z]/);
  });

  it("keeps store brand names as-is", () => {
    for (const [store, name] of [
      ["STEAM", "Steam"],
      ["EPIC_GAMES_STORE", "Epic"],
      ["GOG", "GOG"],
      ["BATTLE_NET", "Battle.net"],
    ] as const) {
      expect(getStoreDisplayName(store, t)).toBe(name);
    }
  });
});
