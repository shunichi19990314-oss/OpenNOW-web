import { useCallback, useEffect, useRef, useState } from "react";

import {
  beginSession,
  checkpointSession,
  finishSession,
  liveSessionSeconds,
  loadPlaytimeSnapshot,
  loadPlaytimeStore,
  PLAYTIME_CHECKPOINT_MS,
  PLAYTIME_STORAGE_KEY,
  recoverAbandonedSession,
  savePlaytimeSnapshot,
  type PlaytimeRecord,
  type PlaytimeSnapshot,
  type PlaytimeStore,
} from "../lib/playtimeStore";

export { PLAYTIME_STORAGE_KEY };
export type { PlaytimeRecord, PlaytimeStore };

/**
 * Playtime tracking hook.
 *
 * The elapsed time of a running session is flushed to storage every
 * `PLAYTIME_CHECKPOINT_MS` and again on `pagehide`/`visibilitychange`, and a
 * session that never reported its end is reclaimed on the next launch. Before
 * that, closing or reloading the tab mid-game discarded the whole session, so
 * the rail could show ten-plus launches next to barely an hour of playtime.
 */
function loadStore(): PlaytimeStore {
  return loadPlaytimeStore();
}

function saveStore(store: PlaytimeStore): void {
  savePlaytimeSnapshot({ store, active: null });
}

function emptyRecord(): PlaytimeRecord {
  return { totalSeconds: 0, lastPlayedAt: null, sessionCount: 0 };
}

/**
 * Human-readable total playtime.
 *
 * `< 1 min` and "Never played" are deliberately different: a launch that has
 * been recorded but has not reached a minute yet is not the same as a game the
 * visitor has never touched.
 */
export function formatPlaytime(totalSeconds: number, neverLabel = "Never played"): string {
  // localStorage is visitor-editable, so guard against NaN/Infinity here too:
  // `Math.floor(Infinity / 3600)` used to render "Infinity h".
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return neverLabel;
  }
  const wholeSeconds = Math.floor(totalSeconds);
  if (wholeSeconds < 60) {
    return "< 1 min";
  }
  const h = Math.floor(wholeSeconds / 3600);
  const m = Math.floor((wholeSeconds % 3600) / 60);
  if (h === 0) return `${m} m`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}

export function formatRemainingPlaytimeFromSubscription(
  subscription: { isUnlimited: boolean; remainingHours: number } | null,
  consumedHours = 0,
  unlimitedLabel = "Unlimited",
): string {
  if (!subscription) {
    return "--";
  }
  if (subscription.isUnlimited) {
    return unlimitedLabel;
  }

  const baseHours = Number.isFinite(subscription.remainingHours) ? subscription.remainingHours : 0;
  const safeHours = Math.max(0, baseHours - Math.max(0, consumedHours));
  const totalMinutes = Math.round(safeHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }
  return `${minutes}m`;
}

export interface UsePlaytimeReturn {
  playtime: PlaytimeStore;
  startSession: (gameId: string) => void;
  endSession: (gameId: string) => void;
}

/**
 * Initial snapshot: reclaim time from a session the last visit never closed and
 * persist the result straight away, so a second tab cannot fold it in again.
 */
function loadInitialSnapshot(): PlaytimeSnapshot {
  const loaded = loadPlaytimeSnapshot();
  const recovered = recoverAbandonedSession(loaded);
  if (recovered !== loaded) {
    savePlaytimeSnapshot(recovered);
  }
  return recovered;
}

export function usePlaytime(): UsePlaytimeReturn {
  const [snapshot, setSnapshot] = useState<PlaytimeSnapshot>(loadInitialSnapshot);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const commit = useCallback((next: PlaytimeSnapshot): void => {
    snapshotRef.current = next;
    savePlaytimeSnapshot(next);
    setSnapshot(next);
  }, []);

  const startSession = useCallback((gameId: string): void => {
    commit(beginSession(snapshotRef.current, gameId));
  }, [commit]);

  const endSession = useCallback((gameId: string): void => {
    const current = snapshotRef.current;
    if (!current.active || current.active.gameId !== gameId) return;
    commit(finishSession(current, gameId));
  }, [commit]);

  // Periodic checkpoint while a session is running. This is what makes tab
  // closes, reloads and crashes recoverable: at most one interval is lost.
  useEffect(() => {
    if (!snapshot.active) return undefined;
    const tick = (): void => {
      const current = snapshotRef.current;
      if (!current.active) return;
      // Sub-second sessions are not worth a write; skip until there is progress.
      if (liveSessionSeconds(current.active) < 1) return;
      commit(checkpointSession(current));
    };
    const timer = window.setInterval(tick, PLAYTIME_CHECKPOINT_MS);
    const flush = (): void => tick();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [commit, snapshot.active]);

  return { playtime: snapshot.store, startSession, endSession };
}

export const playtimeInternals = {
  loadStore,
  saveStore,
  emptyRecord,
};
