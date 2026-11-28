import { describe, expect, it } from "vitest";

import type { GameInfo } from "@shared/gfn";

import {
  gameHasSavedRoute,
  launchRouteLabel,
  launchRouteStreamingUrl,
  loadLaunchRoutes,
  MAX_LAUNCH_ROUTE_RECORDS,
  recordLaunchRoute,
  saveLaunchRoutes,
  splitResumeEntries,
  type LaunchRouteStore,
} from "./launchRoutes";

/**
 * The rail used to offer one "起動" per game, so a session that ran on a
 * Japanese region or an alliance server was silently replaced by the default
 * route on the next click. These cases pin what is stored, what is displayed
 * and when the tile is allowed to claim it can resume on that server.
 */

function game(id: string, extra: Partial<GameInfo> = {}): GameInfo {
  return {
    id,
    title: `Game ${id}`,
    selectedVariantIndex: 0,
    variants: [{ id: `v-${id}`, store: "STEAM", supportedControls: [] }],
    ...extra,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    data,
  };
}

describe("recording a launch route", () => {
  it("keeps the newest route per game", () => {
    let routes: LaunchRouteStore = {};
    routes = recordLaunchRoute(routes, "g1", { streamingBaseUrl: "https://jp.example", atMs: 1 });
    routes = recordLaunchRoute(routes, "g1", { streamingBaseUrl: "https://eu.example", atMs: 2 });
    expect(Object.keys(routes)).toEqual(["g1"]);
    expect(routes.g1.streamingBaseUrl).toBe("https://eu.example");
    expect(routes.g1.lastLaunchedAtMs).toBe(2);
  });

  it("ignores a missing game id", () => {
    expect(recordLaunchRoute({}, "", { streamingBaseUrl: "https://x" })).toEqual({});
  });

  it("caps the store, dropping the oldest routes", () => {
    let routes: LaunchRouteStore = {};
    for (let index = 0; index < MAX_LAUNCH_ROUTE_RECORDS + 5; index += 1) {
      routes = recordLaunchRoute(routes, `g${index}`, {
        streamingBaseUrl: `https://host-${index}.example`,
        atMs: index,
      });
    }
    expect(Object.keys(routes)).toHaveLength(MAX_LAUNCH_ROUTE_RECORDS);
    // The five oldest are gone; the newest is kept.
    expect(routes.g0).toBeUndefined();
    expect(routes[`g${MAX_LAUNCH_ROUTE_RECORDS + 4}`]).toBeDefined();
  });
});

describe("what the tile may claim", () => {
  it("treats a plain NVIDIA launch as the default route", () => {
    const route = { streamingBaseUrl: "", providerName: "NVIDIA", lastLaunchedAtMs: 1 };
    expect(launchRouteLabel(route)).toBeNull();
    expect(gameHasSavedRoute(route)).toBe(false);
    expect(launchRouteStreamingUrl(route)).toBeUndefined();
  });

  it("labels a custom server by hostname", () => {
    const route = { streamingBaseUrl: "https://jp.cloud.example/stream", lastLaunchedAtMs: 1 };
    expect(launchRouteLabel(route)).toBe("jp.cloud.example");
    expect(launchRouteStreamingUrl(route)).toBe("https://jp.cloud.example/stream");
  });

  it("falls back to the provider name when there is no custom URL", () => {
    expect(launchRouteLabel({ streamingBaseUrl: "", providerName: "Alliance JP", lastLaunchedAtMs: 1 }))
      .toBe("Alliance JP");
  });

  it("never resumes a game that is no longer launchable", () => {
    const routes: LaunchRouteStore = {
      gone: { streamingBaseUrl: "https://jp.example", lastLaunchedAtMs: 5 },
      alive: { streamingBaseUrl: "https://eu.example", lastLaunchedAtMs: 4 },
    };
    const entries = [
      { game: game("gone", { variants: [] }), lastPlayedMs: 10, totalSeconds: 60, sessionCount: 1 },
      { game: game("alive"), lastPlayedMs: 9, totalSeconds: 60, sessionCount: 1 },
    ];
    const { resumable, others } = splitResumeEntries(entries, routes);
    expect(resumable.map((entry) => entry.game.id)).toEqual(["alive"]);
    expect(others.map((entry) => entry.game.id)).toEqual(["gone"]);
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    const routes = recordLaunchRoute({}, "g1", {
      streamingBaseUrl: "https://jp.example",
      providerName: "NVIDIA",
      atMs: 7,
    });
    saveLaunchRoutes(routes, storage);
    expect(loadLaunchRoutes(storage)).toEqual(routes);
  });

  it("ignores corrupt and foreign payloads instead of throwing", () => {
    expect(loadLaunchRoutes(memoryStorage({ "opennow.launchRoutes.v1": "{oops" }))).toEqual({});
    expect(loadLaunchRoutes(memoryStorage({ "opennow.launchRoutes.v1": "[1,2,3]" }))).toEqual({});
    expect(loadLaunchRoutes(null)).toEqual({});
  });

  it("drops entries with nothing to resume", () => {
    const storage = memoryStorage({
      "opennow.launchRoutes.v1": JSON.stringify({ g1: { streamingBaseUrl: "", lastLaunchedAtMs: 1 } }),
    });
    expect(loadLaunchRoutes(storage)).toEqual({});
  });
});
