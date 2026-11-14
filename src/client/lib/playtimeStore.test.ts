import { describe, expect, it } from "vitest";

import {
  beginSession,
  checkpointSession,
  finishSession,
  liveSessionSeconds,
  loadPlaytimeSnapshot,
  loadPlaytimeStore,
  recoverAbandonedSession,
  savePlaytimeSnapshot,
  type PlaytimeStorage,
} from "./playtimeStore";

/**
 * These rules encode the reported bug: the rail showed "18 回プレイ" beside
 * "1 h 11 min" and "未プレイ / 1回プレイ" on the same card, because a session
 * only counted when it ended cleanly and the catalog value was read separately.
 */

function memoryStorage(seed?: string): PlaytimeStorage & { value: string | null } {
  const holder = {
    value: seed ?? null,
    getItem: () => holder.value,
    setItem: (_key: string, next: string) => {
      holder.value = next;
    },
  };
  return holder;
}

const T0 = Date.UTC(2026, 10, 14, 9, 0, 0);

describe("session accounting", () => {
  it("counts a session that ends cleanly", () => {
    const started = beginSession({ store: {}, active: null }, "g1", T0);
    expect(started.store.g1).toEqual({ totalSeconds: 0, lastPlayedAt: new Date(T0).toISOString(), sessionCount: 1 });

    const ended = finishSession(started, "g1", T0 + 90_000);
    expect(ended.store.g1?.totalSeconds).toBe(90);
    expect(ended.active).toBeNull();
  });

  it("does not lose time when the tab is closed without a stop", () => {
    // The old tracker returned early here, so the whole session vanished.
    const started = beginSession({ store: {}, active: null }, "g1", T0);
    // Last checkpoint one hour in, then the tab is closed 2 minutes later.
    const checkpointed = checkpointSession(started, T0 + 3_600_000);
    const stored = JSON.parse(JSON.stringify(checkpointed));

    // Recovered a day later: only the recovery grace is attributable, so the
    // closed tab is not billed for the whole day.
    const recovered = recoverAbandonedSession(stored, T0 + 3_600_000 + 24 * 60 * 60 * 1000);
    expect(recovered.store.g1?.totalSeconds).toBe(3_600 + 15);
    expect(recovered.active).toBeNull();
    // The launch was already counted at start; reclaiming must not add another.
    expect(recovered.store.g1?.sessionCount).toBe(1);
  });

  it("checkpointing never double counts", () => {
    let snapshot = beginSession({ store: {}, active: null }, "g1", T0);
    // Checkpoint every 15s for a minute, then end.
    for (let tick = 1; tick <= 4; tick += 1) {
      snapshot = checkpointSession(snapshot, T0 + tick * 15_000);
    }
    snapshot = finishSession(snapshot, "g1", T0 + 60_000);
    expect(snapshot.store.g1?.totalSeconds).toBe(60);
  });

  it("survives a reload by resuming from the checkpoint", () => {
    const started = beginSession({ store: {}, active: null }, "g1", T0);
    const checkpointed = checkpointSession(started, T0 + 600_000);
    // Simulate a page reload: persist, read back, continue running.
    const storage = memoryStorage();
    savePlaytimeSnapshot(checkpointed, storage);
    const reloaded = loadPlaytimeSnapshot(storage, T0 + 620_000);
    expect(reloaded.store.g1?.totalSeconds).toBe(600);
    expect(reloaded.active?.gameId).toBe("g1");

    const finished = finishSession(reloaded, "g1", T0 + 650_000);
    // 600 s committed by the checkpoint + the 50 s since that checkpoint.
    expect(finished.store.g1?.totalSeconds).toBe(650);
  });

  it("folds an in-flight session into the total when the same game restarts", () => {
    const first = beginSession({ store: {}, active: null }, "g1", T0);
    const second = beginSession(first, "g1", T0 + 120_000);
    expect(second.store.g1?.sessionCount).toBe(2);
    expect(second.store.g1?.totalSeconds).toBe(120);
    expect(finishSession(second, "g1", T0 + 180_000).store.g1?.totalSeconds).toBe(180);
  });

  it("keeps an abandoned session for a different game instead of dropping it", () => {
    const first = beginSession({ store: {}, active: null }, "g1", T0);
    const second = beginSession(first, "g2", T0 + 300_000);
    expect(second.store.g1?.totalSeconds).toBe(300);
    expect(second.store.g2?.sessionCount).toBe(1);
  });

  it("ignores an end for a game that is not the running session", () => {
    const started = beginSession({ store: {}, active: null }, "g1", T0);
    expect(finishSession(started, "g2", T0 + 60_000)).toBe(started);
  });

  it("drops implausible session timestamps instead of billing them", () => {
    const future = { store: {}, active: { gameId: "g1", startedAtMs: T0 + 86_400_000 * 3, elapsedSeconds: 0 } };
    expect(recoverAbandonedSession(future, T0).store).toEqual({});
    const ancient = { store: {}, active: { gameId: "g1", startedAtMs: T0 - 86_400_000 * 30, elapsedSeconds: 0 } };
    expect(recoverAbandonedSession(ancient, T0).store).toEqual({});
  });

  it("computes live seconds from marker plus elapsed", () => {
    expect(liveSessionSeconds({ gameId: "g", startedAtMs: T0, elapsedSeconds: 600 }, T0 + 30_000)).toBe(630);
    // A clock that moved backwards must not produce negative time.
    expect(liveSessionSeconds({ gameId: "g", startedAtMs: T0, elapsedSeconds: 600 }, T0 - 60_000)).toBe(600);
  });
});

describe("persisted payloads", () => {
  it("still reads the legacy bare record map", () => {
    const storage = memoryStorage(JSON.stringify({ g1: { totalSeconds: 42, lastPlayedAt: "2026-01-01T00:00:00.000Z", sessionCount: 2 } }));
    expect(loadPlaytimeStore(storage)).toEqual({
      g1: { totalSeconds: 42, lastPlayedAt: "2026-01-01T00:00:00.000Z", sessionCount: 2 },
    });
    expect(loadPlaytimeSnapshot(storage).active).toBeNull();
  });

  it("survives a corrupt payload", () => {
    expect(loadPlaytimeSnapshot(memoryStorage("{not json"))).toEqual({ store: {}, active: null });
    expect(loadPlaytimeSnapshot(memoryStorage("[1,2,3]"))).toEqual({ store: {}, active: null });
    expect(loadPlaytimeSnapshot(memoryStorage("null"))).toEqual({ store: {}, active: null });
  });

  it("drops malformed records and sessions", () => {
    const storage = memoryStorage(JSON.stringify({
      store: { bad: { totalSeconds: "nope" }, good: { totalSeconds: 12 } },
      active: { gameId: "", startedAtMs: 1 },
    }));
    const snapshot = loadPlaytimeSnapshot(storage);
    expect(Object.keys(snapshot.store)).toEqual(["good"]);
    expect(snapshot.active).toBeNull();
  });

  it("writes an envelope that can be read back", () => {
    const storage = memoryStorage();
    savePlaytimeSnapshot({ store: { g1: { totalSeconds: 5, lastPlayedAt: null, sessionCount: 1 } }, active: null }, storage);
    expect(loadPlaytimeSnapshot(storage).store.g1?.totalSeconds).toBe(5);
  });

  it("does not bill an overnight-closed tab as playtime", () => {
    // Checkpointed after 10 minutes, then the machine was left off overnight.
    const started = beginSession({ store: {}, active: null }, "g1", T0);
    const checkpointed = checkpointSession(started, T0 + 600_000);
    const recovered = recoverAbandonedSession(checkpointed, T0 + 600_000 + 9 * 60 * 60 * 1000);
    expect(recovered.store.g1?.totalSeconds).toBe(615); // 10 min + one grace interval
  });

  it("still credits a throttled background tab as continuous play", () => {
    // A suspended laptop can pause timers for minutes: that is real gameplay.
    const started = beginSession({ store: {}, active: null }, "g1", T0);
    const checked = checkpointSession(started, T0 + 60_000);
    const recovered = recoverAbandonedSession(checked, T0 + 60_000 + 4 * 60_000);
    expect(recovered.store.g1?.totalSeconds).toBe(300);
  });
});
