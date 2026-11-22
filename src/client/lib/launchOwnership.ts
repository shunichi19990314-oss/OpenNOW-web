import type { GameInfo, GameVariant, StreamRegion, SubscriptionInfo } from "@shared/gfn";
import { isEpicStore, isGameInLibrary, isOwnedVariant } from "@shared/gfn";

export interface LaunchOwnershipError {
  title: string;
  description: string;
}

// Rendered in the launch error overlay, so the copy is Japanese. It lives here
// rather than in `t()` because the helper is sync and has no translator.
const EPIC_OWNERSHIP_ERROR: LaunchOwnershipError = {
  title: "Epic Games のライブラリが必要です",
  description:
    "この Epic Games 版は GeForce NOW のライブラリにありません。Epic に追加して GeForce NOW を同期するか、所有済みの別ストアを選んでください。",
};

export function isInstallToPlayGame(game: Pick<GameInfo, "playType">): boolean {
  return game.playType === "INSTALL_TO_PLAY";
}

function normalizeRegionName(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function resolveInstallToPlayStorageRegionUrl(
  game: Pick<GameInfo, "playType">,
  subscription: Pick<SubscriptionInfo, "storageAddon"> | null | undefined,
  regions: readonly StreamRegion[],
): string | null {
  if (!isInstallToPlayGame(game)) {
    return null;
  }

  const storageRegionName = normalizeRegionName(subscription?.storageAddon?.regionName);
  if (!storageRegionName) {
    return null;
  }

  return regions.find((region) => normalizeRegionName(region.name) === storageRegionName)?.url ?? null;
}

export function chooseAccountLinked(game: Pick<GameInfo, "playType" | "isInLibrary" | "variants">, selectedVariant?: GameVariant): boolean {
  if (isInstallToPlayGame(game)) {
    return false;
  }

  if (selectedVariant && isOwnedVariant(selectedVariant)) {
    return true;
  }

  if (game.isInLibrary === true) {
    return true;
  }

  return isGameInLibrary(game);
}

export function getEpicOwnershipLaunchError(selectedVariant?: GameVariant): LaunchOwnershipError | null {
  if (!selectedVariant) {
    return null;
  }

  if (!isEpicStore(selectedVariant.store)) {
    return null;
  }

  if (isOwnedVariant(selectedVariant)) {
    return null;
  }

  return EPIC_OWNERSHIP_ERROR;
}
