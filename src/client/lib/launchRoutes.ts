import type { GameInfo } from "@shared/gfn";

import type { RecentActivityEntry } from "./localPreferences";

/**
 * Where the visitor last played from.
 *
 * GeForce NOW has several routes to the same title — a Japanese region, a
 * partner/alliance provider, a proxy — and they perform very differently. The
 * "続きからプレイ" rail offered one button per game, so someone whose last
 * session came through an alliance server had no way to say so, and the launch
 * fell back to the default route.
 *
 * The last route is recorded at launch time (the same moment playtime starts)
 * and shown on the tile; the tile's primary action resumes it. Only facts the
 * app actually knows are recorded: the streaming base URL and provider name.
 * Nothing is inferred, and a missing record simply means "use the default".
 */

export interface GameLaunchRoute {
  /** Streaming base URL the session was created against; empty for the default. */
  streamingBaseUrl: string;
  /** Provider label the session was created with (e.g. `NVIDIA`, an alliance name). */
  providerName?: string;
  /** Epoch ms of the launch that recorded it. */
  lastLaunchedAtMs: number;
}

export type LaunchRouteStore = Record<string, GameLaunchRoute>;

export const LAUNCH_ROUTES_STORAGE_KEY = "opennow.launchRoutes.v1";

/** Only the newest few are kept: this is a convenience, not history. */
export const MAX_LAUNCH_ROUTE_RECORDS = 200;

/** Hostname for display, falling back to the raw value when it is not a URL. */
export function launchRouteHost(route: GameLaunchRoute | undefined): string | null {
  const raw = route?.streamingBaseUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.host || null;
  } catch {
    return raw.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "") || null;
  }
}

/**
 * Human-readable route label, or `null` when it would say nothing.
 *
 * The default route needs no label — every tile would carry the same chip and
 * it would read as decoration. A custom host or provider is the information.
 */
export function launchRouteLabel(route: GameLaunchRoute | undefined): string | null {
  const host = launchRouteHost(route);
  if (host) return host;
  const provider = route?.providerName?.trim();
  return provider && provider.toUpperCase() !== "NVIDIA" ? provider : null;
}

export function isDefaultLaunchRoute(route: GameLaunchRoute | undefined): boolean {
  return launchRouteLabel(route) === null;
}

/** Drop entries the UI can never use, and non-plausible timestamps. */
function sanitizeStore(value: unknown): LaunchRouteStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const store: LaunchRouteStore = {};
  for (const [gameId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!gameId || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Partial<GameLaunchRoute>;
    const streamingBaseUrl = typeof record.streamingBaseUrl === "string" ? record.streamingBaseUrl.trim() : "";
    const providerName = typeof record.providerName === "string" ? record.providerName.trim() : undefined;
    const lastLaunchedAtMs = typeof record.lastLaunchedAtMs === "number" && Number.isFinite(record.lastLaunchedAtMs)
      ? record.lastLaunchedAtMs
      : 0;
    if (!streamingBaseUrl && !providerName) continue;
    store[gameId] = {
      streamingBaseUrl,
      ...(providerName ? { providerName } : {}),
      lastLaunchedAtMs: Math.max(0, lastLaunchedAtMs),
    };
  }
  return store;
}

export function loadLaunchRoutes(storage?: Pick<Storage, "getItem"> | null): LaunchRouteStore {
  try {
    const raw = storage?.getItem(LAUNCH_ROUTES_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeStore(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export function saveLaunchRoutes(
  routes: LaunchRouteStore,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    storage?.setItem(LAUNCH_ROUTES_STORAGE_KEY, JSON.stringify(routes));
  } catch {
    // Quota or a locked-down profile: the feature degrades to the default route.
  }
}

/**
 * Record the route a launch used. Re-recording the same game keeps only the
 * newest entry, and the store is capped so it cannot grow without bound.
 */
export function recordLaunchRoute(
  routes: LaunchRouteStore,
  gameId: string,
  route: { streamingBaseUrl?: string; providerName?: string; atMs?: number },
): LaunchRouteStore {
  if (!gameId) return routes;
  const streamingBaseUrl = route.streamingBaseUrl?.trim() ?? "";
  const providerName = route.providerName?.trim();
  // A default launch with no provider still carries information: it says the
  // last attempt did not use a saved custom route.
  const next: LaunchRouteStore = {
    ...routes,
    [gameId]: {
      streamingBaseUrl,
      ...(providerName ? { providerName } : {}),
      lastLaunchedAtMs: route.atMs ?? Date.now(),
    },
  };

  const entries = Object.entries(next);
  if (entries.length <= MAX_LAUNCH_ROUTE_RECORDS) return next;
  entries.sort((left, right) => right[1].lastLaunchedAtMs - left[1].lastLaunchedAtMs);
  return Object.fromEntries(entries.slice(0, MAX_LAUNCH_ROUTE_RECORDS));
}

/**
 * Split the rail's entries into "resume from the saved route" and the rest.
 *
 * The saved route needs to be launchable, so entries whose game is no longer
 * in the catalog are dropped from the shortcut list — a dead id would hand the
 * launch flow a URL for a game the account can no longer open.
 */
export function splitResumeEntries(
  entries: readonly RecentActivityEntry[],
  routes: LaunchRouteStore,
): { resumable: RecentActivityEntry[]; others: RecentActivityEntry[] } {
  const resumable: RecentActivityEntry[] = [];
  const others: RecentActivityEntry[] = [];
  for (const entry of entries) {
    const route = routes[entry.game.id];
    if (route && !isDefaultLaunchRoute(route) && entry.game.variants.length > 0) {
      resumable.push(entry);
    } else {
      others.push(entry);
    }
  }
  return { resumable, others };
}

/** The launch URL to pass through, or `undefined` for the default route. */
export function launchRouteStreamingUrl(route: GameLaunchRoute | undefined): string | undefined {
  const url = route?.streamingBaseUrl?.trim();
  return url && url.length > 0 ? url : undefined;
}

export function gameHasSavedRoute(route: GameLaunchRoute | undefined): boolean {
  return Boolean(route) && !isDefaultLaunchRoute(route);
}

export function routeForGame(routes: LaunchRouteStore, game: Pick<GameInfo, "id">): GameLaunchRoute | undefined {
  return routes[game.id];
}
