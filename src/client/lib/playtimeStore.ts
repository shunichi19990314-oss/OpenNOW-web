import type { GameInfo } from "@shared/gfn";

/**
 * Local playtime tracking.
 *
 * The tracker used to only commit elapsed time when a session ended *cleanly*
 * (`/api/stream/stop` or an expected signaling close). On the web client a
 * session usually ends by closing the tab, reloading, or the machine sleeping —
 * none of which reach that path — so the rail could show "18 回プレイ" next to
 * "1 h 11 min". Everything here is pure or storage-injectable so the accounting
 * rules are unit-testable without a DOM.
 */

export const PLAYTIME_STORAGE_KEY = "opennow:playtime";

/** How often the running session is flushed to storage. */
export const PLAYTIME_CHECKPOINT_MS = 15_000;

/**
 * Maximum time credited after the last heartbeat when reclaiming an abandoned
 * session.
 *
 * The marker is rewritten on every checkpoint (and on `pagehide`), so at close
 * time it is at most one interval stale. Reclaiming "up to now" instead would
 * bill the visitor for the hours the tab sat closed — a 4-minute session that
 * ended yesterday would look like a full day of playtime.
 */
export const PLAYTIME_RECOVERY_GRACE_MS = PLAYTIME_CHECKPOINT_MS;

/**
 * Gap between heartbeats that still counts as continuous play.
 *
 * Background tabs throttle timers to roughly once a minute, and a suspended
 * laptop can pause them for several minutes, so a gap larger than the
 * checkpoint interval is still normal gameplay. Beyond this window the tab was
 * almost certainly closed and only the recovery grace is credited.
 */
export const PLAYTIME_CONTINUITY_MS = 5 * 60 * 1000;

/** Ignore impossibly old or future timestamps from a hand-edited payload. */
const MAX_PLAUSIBLE_SESSION_MS = 24 * 60 * 60 * 1000;

/** Minimum gameplay that counts as a session at all. */
const MIN_COUNTED_SECONDS = 1;

export interface PlaytimeRecord {
  totalSeconds: number;
  lastPlayedAt: string | null;
  sessionCount: number;
}

/** A session that is still considered running when the app is closed. */
export interface ActiveSessionRecord {
  gameId: string;
  /** Epoch ms when the session was started or last checkpointed. */
  startedAtMs: number;
  /** Seconds already committed for this session (survives a reload). */
  elapsedSeconds: number;
}

export type PlaytimeStore = Record<string, PlaytimeRecord>;

export interface PlaytimeSnapshot {
  store: PlaytimeStore;
  active: ActiveSessionRecord | null;
}

export interface PlaytimeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function resolveStorage(explicit?: PlaytimeStorage | null): PlaytimeStorage | null {
  if (explicit) return explicit;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Safari private mode can throw on property access.
    return null;
  }
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toIsoStringOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/** Normalize one stored record, returning null when nothing usable is left. */
export function normalizePlaytimeRecord(value: unknown): PlaytimeRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<PlaytimeRecord>;
  const totalSeconds = toNonNegativeInteger(record.totalSeconds);
  const sessionCount = toNonNegativeInteger(record.sessionCount);
  const lastPlayedAt = toIsoStringOrNull(record.lastPlayedAt);
  if (totalSeconds === 0 && sessionCount === 0 && lastPlayedAt === null) return null;
  return { totalSeconds, sessionCount, lastPlayedAt };
}

function normalizeActiveSession(value: unknown, nowMs: number): ActiveSessionRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const active = value as Partial<ActiveSessionRecord>;
  if (typeof active.gameId !== "string" || active.gameId.length === 0) return null;
  const startedAtMs = typeof active.startedAtMs === "number" && Number.isFinite(active.startedAtMs)
    ? active.startedAtMs
    : 0;
  if (startedAtMs <= 0 || startedAtMs > nowMs + 60_000) return null;
  return {
    gameId: active.gameId,
    startedAtMs,
    elapsedSeconds: toNonNegativeInteger(active.elapsedSeconds),
  };
}

function emptySnapshot(): PlaytimeSnapshot {
  return { store: {}, active: null };
}

/**
 * Read both the totals and the in-flight session marker.
 *
 * Older builds wrote the bare `{ [gameId]: record }` map, so a payload without
 * the envelope keys is still accepted and read as the record map.
 */
export function loadPlaytimeSnapshot(
  storage?: PlaytimeStorage | null,
  nowMs: number = Date.now(),
): PlaytimeSnapshot {
  const target = resolveStorage(storage);
  if (!target) return emptySnapshot();
  let raw: string | null = null;
  try {
    raw = target.getItem(PLAYTIME_STORAGE_KEY);
  } catch {
    return emptySnapshot();
  }
  if (!raw) return emptySnapshot();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySnapshot();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptySnapshot();

  const envelope = parsed as { store?: unknown; active?: unknown };
  const hasEnvelope = "store" in envelope || "active" in envelope;
  const rawStore = hasEnvelope ? envelope.store : parsed;
  const store: Record<string, PlaytimeRecord> = {};
  if (rawStore && typeof rawStore === "object" && !Array.isArray(rawStore)) {
    for (const [gameId, value] of Object.entries(rawStore as Record<string, unknown>)) {
      const record = normalizePlaytimeRecord(value);
      if (record) store[gameId] = record;
    }
  }

  return {
    store,
    active: hasEnvelope ? normalizeActiveSession(envelope.active, nowMs) : null,
  };
}

/** Backwards-compatible record-only read. */
export function loadPlaytimeStore(
  storage?: PlaytimeStorage | null,
  nowMs: number = Date.now(),
): PlaytimeStore {
  return loadPlaytimeSnapshot(storage, nowMs).store;
}

export function savePlaytimeSnapshot(
  snapshot: PlaytimeSnapshot,
  storage?: PlaytimeStorage | null,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(PLAYTIME_STORAGE_KEY, JSON.stringify({ store: snapshot.store, active: snapshot.active }));
  } catch {
    // Quota or private mode: tracking is best-effort, never fatal.
  }
}

/** Seconds elapsed in the running session as of `nowMs` (including checkpoints). */
export function liveSessionSeconds(active: ActiveSessionRecord, nowMs: number = Date.now()): number {
  const deltaMs = Math.max(0, nowMs - active.startedAtMs);
  return active.elapsedSeconds + Math.floor(deltaMs / 1000);
}

/**
 * Seconds that may be credited to a marker, capped past its last heartbeat.
 *
 * The marker is rewritten every checkpoint interval (and on `pagehide`), so the
 * tail after the last write is what needs bounding: a gap within
 * `PLAYTIME_CONTINUITY_MS` is treated as continuous play (throttled timers, a
 * suspended laptop), anything longer as a closed tab that only earns the
 * recovery grace. Without the cap, a session left open overnight billed the
 * whole night as playtime.
 */
export function attributableSessionSeconds(active: ActiveSessionRecord, nowMs: number = Date.now()): number {
  const gapMs = Math.max(0, nowMs - active.startedAtMs);
  const creditableMs = gapMs <= PLAYTIME_CONTINUITY_MS ? gapMs : PLAYTIME_RECOVERY_GRACE_MS;
  return active.elapsedSeconds + Math.floor(creditableMs / 1000);
}

/**
 * Reclaim time from a session that never reported its end.
 *
 * Without this, closing the tab mid-game dropped the whole session from the
 * totals, which is exactly the "18 sessions / 1 h 11 min" symptom.
 */
export function recoverAbandonedSession(
  snapshot: PlaytimeSnapshot,
  nowMs: number = Date.now(),
): PlaytimeSnapshot {
  const active = snapshot.active;
  if (!active) return snapshot;
  const ageMs = nowMs - active.startedAtMs;
  if (ageMs < 0 || ageMs > MAX_PLAUSIBLE_SESSION_MS) {
    // Nonsense timestamps are dropped rather than attributed to a game.
    return { store: snapshot.store, active: null };
  }
  const seconds = attributableSessionSeconds(active, nowMs);
  if (seconds < MIN_COUNTED_SECONDS) {
    return { store: snapshot.store, active: null };
  }
  const existing = snapshot.store[active.gameId];
  return {
    store: {
      ...snapshot.store,
      [active.gameId]: {
        totalSeconds: (existing?.totalSeconds ?? 0) + seconds,
        lastPlayedAt: new Date(active.startedAtMs).toISOString(),
        // The session was already counted when it started.
        sessionCount: existing?.sessionCount ?? 0,
      },
    },
    active: null,
  };
}

/**
 * Start (or resume) a session for a game, folding any previous in-flight
 * session of the same game into its total first.
 */
export function beginSession(
  snapshot: PlaytimeSnapshot,
  gameId: string,
  nowMs: number = Date.now(),
): PlaytimeSnapshot {
  // A different game was still "active": its time is real gameplay, keep it.
  // Same session: fold it in below. A different game with a live marker gets
  // its full elapsed time credited — this is an in-app transition, not a tab
  // that sat closed, so the recovery grace does not apply.
  const base = snapshot.active && snapshot.active.gameId !== gameId
    ? (() => {
      const previous = snapshot.active as ActiveSessionRecord;
      const seconds = attributableSessionSeconds(previous, nowMs);
      const existing = snapshot.store[previous.gameId];
      return {
        store: {
          ...snapshot.store,
          [previous.gameId]: {
            totalSeconds: (existing?.totalSeconds ?? 0) + seconds,
            lastPlayedAt: new Date(previous.startedAtMs).toISOString(),
            sessionCount: existing?.sessionCount ?? 0,
          },
        },
        active: null,
      } satisfies PlaytimeSnapshot;
    })()
    : snapshot;

  let store = base.store;
  if (base.active && base.active.gameId === gameId) {
    const seconds = attributableSessionSeconds(base.active, nowMs);
    if (seconds > 0) {
      const existing = store[gameId];
      store = {
        ...store,
        [gameId]: {
          totalSeconds: (existing?.totalSeconds ?? 0) + seconds,
          lastPlayedAt: existing?.lastPlayedAt ?? null,
          sessionCount: existing?.sessionCount ?? 0,
        },
      };
    }
  }

  const existing = store[gameId];
  return {
    store: {
      ...store,
      [gameId]: {
        totalSeconds: existing?.totalSeconds ?? 0,
        lastPlayedAt: new Date(nowMs).toISOString(),
        sessionCount: (existing?.sessionCount ?? 0) + 1,
      },
    },
    active: { gameId, startedAtMs: nowMs, elapsedSeconds: 0 },
  };
}

/** Commit the elapsed part of the running session without ending it. */
export function checkpointSession(
  snapshot: PlaytimeSnapshot,
  nowMs: number = Date.now(),
): PlaytimeSnapshot {
  const active = snapshot.active;
  if (!active) return snapshot;
  const seconds = liveSessionSeconds(active, nowMs);
  if (seconds < MIN_COUNTED_SECONDS) {
    return { store: snapshot.store, active: { ...active, startedAtMs: nowMs, elapsedSeconds: 0 } };
  }
  const existing = snapshot.store[active.gameId];
  return {
    store: {
      ...snapshot.store,
      [active.gameId]: {
        totalSeconds: (existing?.totalSeconds ?? 0) + seconds,
        lastPlayedAt: existing?.lastPlayedAt ?? null,
        sessionCount: existing?.sessionCount ?? 0,
      },
    },
    active: { ...active, startedAtMs: nowMs, elapsedSeconds: 0 },
  };
}

/** End the running session, committing whatever is left. */
export function finishSession(
  snapshot: PlaytimeSnapshot,
  gameId?: string,
  nowMs: number = Date.now(),
): PlaytimeSnapshot {
  const active = snapshot.active;
  if (!active) return snapshot;
  if (gameId !== undefined && active.gameId !== gameId) return snapshot;
  const committed = checkpointSession({ ...snapshot, active }, nowMs);
  return { store: committed.store, active: null };
}

/**
 * Activity timestamp for a game: the newest local or catalog signal.
 * A single helper keeps the rail, the hero and the library from disagreeing.
 */
export function gameActivityMs(
  game: Pick<GameInfo, "id" | "lastPlayed" | "variants">,
  playtime: Record<string, { lastPlayedAt?: string | null }> | undefined | null,
): number {
  let newest = 0;
  const local = playtime?.[game.id]?.lastPlayedAt;
  if (local) {
    const ms = Date.parse(local);
    if (Number.isFinite(ms)) newest = Math.max(newest, ms);
  }
  if (game.lastPlayed) {
    const ms = Date.parse(game.lastPlayed);
    if (Number.isFinite(ms)) newest = Math.max(newest, ms);
  }
  for (const variant of game.variants ?? []) {
    const raw = (variant as { lastPlayedDate?: string }).lastPlayedDate;
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) newest = Math.max(newest, ms);
  }
  return newest;
}
