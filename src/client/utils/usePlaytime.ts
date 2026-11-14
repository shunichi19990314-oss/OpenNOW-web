import { useCallback, useRef, useState } from "react";

const STORAGE_KEY = "opennow:playtime";

export interface PlaytimeRecord {
  totalSeconds: number;
  lastPlayedAt: string | null;
  sessionCount: number;
}

export type PlaytimeStore = Record<string, PlaytimeRecord>;

function loadStore(): PlaytimeStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as PlaytimeStore;
    }
  } catch {
  }
  return {};
}

function saveStore(store: PlaytimeStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
  }
}

function emptyRecord(): PlaytimeRecord {
  return { totalSeconds: 0, lastPlayedAt: null, sessionCount: 0 };
}

export function formatPlaytime(totalSeconds: number): string {
  // localStorage is visitor-editable, so guard against NaN/Infinity here too:
  // `Math.floor(Infinity / 3600)` used to render "Infinity h".
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "Never played";
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
): string {
  if (!subscription) {
    return "--";
  }
  if (subscription.isUnlimited) {
    return "Unlimited";
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

export function usePlaytime(): UsePlaytimeReturn {
  const [playtime, setPlaytime] = useState<PlaytimeStore>(loadStore);
  const sessionStartRef = useRef<Record<string, number>>({});
  // Elapsed seconds from an abandoned session, folded in on the next end.
  const pendingElapsedRef = useRef<Record<string, number>>({});

  const startSession = useCallback((gameId: string): void => {
    // A session that is started twice without an end (reconnect, a launch that
    // ends before /api/stream/stop ran, a crash) would otherwise overwrite the
    // original start time and silently drop the elapsed time.
    const previousStart = sessionStartRef.current[gameId];
    if (previousStart != null) {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - previousStart) / 1000));
      if (elapsedSeconds > 0) {
        pendingElapsedRef.current[gameId] = (pendingElapsedRef.current[gameId] ?? 0) + elapsedSeconds;
      }
    }
    sessionStartRef.current[gameId] = Date.now();
    setPlaytime((prev) => {
      const existing = prev[gameId] ?? emptyRecord();
      const next: PlaytimeStore = {
        ...prev,
        [gameId]: {
          ...existing,
          lastPlayedAt: new Date().toISOString(),
          sessionCount: existing.sessionCount + 1,
        },
      };
      saveStore(next);
      return next;
    });
  }, []);

  const endSession = useCallback((gameId: string): void => {
    const startMs = sessionStartRef.current[gameId];
    const carriedSeconds = pendingElapsedRef.current[gameId] ?? 0;
    if (startMs == null && carriedSeconds === 0) return;
    delete sessionStartRef.current[gameId];
    delete pendingElapsedRef.current[gameId];

    const currentSeconds = startMs == null ? 0 : Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const elapsedSeconds = currentSeconds + carriedSeconds;
    if (elapsedSeconds === 0) return;

    setPlaytime((prev) => {
      const existing = prev[gameId] ?? emptyRecord();
      const next: PlaytimeStore = {
        ...prev,
        [gameId]: {
          ...existing,
          totalSeconds: existing.totalSeconds + elapsedSeconds,
        },
      };
      saveStore(next);
      return next;
    });
  }, []);

  return { playtime, startSession, endSession };
}
