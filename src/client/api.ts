import type {
  AuthDeviceLoginChallenge,
  AuthSession,
  GameInfo,
  IceCandidatePayload,
  KeyframeRequest,
  MainToRendererSignalingEvent,
  OpenNowApi,
  PingResult,
  RecordingEntry,
  ScreenshotEntry,
  SendAnswerRequest,
  Settings,
  SignalingConnectRequest,
} from "@shared/gfn";
import {
  createUnsupportedNativeStreamerStatus,
} from "@shared/gfn";
import { unsupportedNativeCloudGsyncCapabilities } from "@shared/cloudGsync";
import type { BrowserSession, QrChallenge, QrPollResult } from "./types";
import { WEB_DEFAULT_SETTINGS } from "./webDefaults";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      "X-OpenNOW-Client": "web",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function toAuthSession(session: BrowserSession): AuthSession {
  return {
    provider: session.provider,
    user: session.user,
    tokens: {
      accessToken: "server-managed",
      idToken: "server-managed",
      expiresAt: Number.MAX_SAFE_INTEGER,
    },
  };
}

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem("opennow.web.settings");
    const stored = raw ? JSON.parse(raw) as Partial<Settings> : {};
    return {
      ...WEB_DEFAULT_SETTINGS,
      ...stored,
      streamClientMode: "web",
      transportMode: "webrtc",
      showNativeStreamerStats: false,
      nativeExternalRenderer: false,
    };
  } catch {
    return { ...WEB_DEFAULT_SETTINGS };
  }
}

function writeSettings(settings: Settings): void {
  localStorage.setItem("opennow.web.settings", JSON.stringify(settings));
}

type SignalingListener = (event: MainToRendererSignalingEvent) => void;
let socket: WebSocket | null = null;
const signalingListeners = new Set<SignalingListener>();

function emitSignaling(event: MainToRendererSignalingEvent): void {
  for (const listener of signalingListeners) listener(event);
}

function sendSignal(type: string, payload?: unknown): Promise<void> {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("The signaling bridge is not connected."));
  }
  socket.send(JSON.stringify({ type, ...(payload === undefined ? {} : { payload }) }));
  return Promise.resolve();
}

async function connectSignaling(payload: SignalingConnectRequest): Promise<void> {
  socket?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/api/signaling`);
  await new Promise<void>((resolve, reject) => {
    const activeSocket = socket;
    if (!activeSocket) return reject(new Error("Unable to create signaling connection."));
    activeSocket.onopen = () => {
      activeSocket.send(JSON.stringify({ type: "connect", payload: { ...payload, nativeStreamer: undefined } }));
      resolve();
    };
    activeSocket.onerror = () => reject(new Error("Unable to open the signaling bridge."));
    activeSocket.onmessage = (message) => {
      try {
        const parsed = JSON.parse(String(message.data)) as { type?: string; payload?: MainToRendererSignalingEvent };
        if (parsed.type === "event" && parsed.payload) emitSignaling(parsed.payload);
      } catch {
        emitSignaling({ type: "error", message: "Received an invalid signaling message." });
      }
    };
    activeSocket.onclose = (event) => emitSignaling({ type: "disconnected", reason: event.reason || "bridge closed" });
  });
}

const screenshots: ScreenshotEntry[] = [];
const recordings: RecordingEntry[] = [];
const recordingChunks = new Map<string, { mimeType: string; chunks: ArrayBuffer[] }>();
const updaterState = {
  status: "disabled" as const,
  currentVersion: "0.5.1-web",
  currentDisplayVersion: "0.5.1 Web",
  updateSource: "github-releases" as const,
  canCheck: false,
  canDownload: false,
  canInstall: false,
  isPackaged: true,
  message: "The web app is updated by its host.",
};

const REGION_PING_CONCURRENCY = 6;
const REGION_PING_TIMEOUT_MS = 6_000;

async function measureRegionLatency(url: string): Promise<PingResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REGION_PING_TIMEOUT_MS);

  try {
    const target = new URL(url);
    if (target.protocol !== "https:") {
      throw new Error("Region latency checks require HTTPS.");
    }

    const startedAt = performance.now();
    await fetch(target.toString(), {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });

    return {
      url,
      pingMs: Math.max(1, Math.round(performance.now() - startedAt)),
    };
  } catch (error) {
    return {
      url,
      pingMs: null,
      error: error instanceof Error ? error.message : "Region latency check failed.",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function pingRegionsInBrowser(regions: Parameters<OpenNowApi["pingRegions"]>[0]): Promise<PingResult[]> {
  const results = new Array<PingResult>(regions.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < regions.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await measureRegionLatency(regions[index].url);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(REGION_PING_CONCURRENCY, regions.length) },
      () => worker(),
    ),
  );

  return results;
}

const bridge: OpenNowApi = {
  getAuthSession: async () => {
    const result = await api<{ session: BrowserSession | null }>("/api/session");
    return {
      session: result.session ? toAuthSession(result.session) : null,
      refresh: { attempted: false, forced: false, outcome: "not_attempted", message: "Server-managed web session." },
    };
  },
  getLoginProviders: () => api("/api/providers"),
  getRegions: () => api("/api/regions"),
  login: async () => { throw new Error("OpenNOW Web uses QR-code sign in."); },
  startDeviceLogin: async (input) => {
    const challenge = await api<QrChallenge>("/api/auth/qr/start", { method: "POST", body: JSON.stringify(input) });
    return { ...challenge, deviceCode: challenge.attemptId } satisfies AuthDeviceLoginChallenge;
  },
  pollDeviceLogin: async (input) => {
    const result = await api<QrPollResult>("/api/auth/qr/poll", { method: "POST", body: JSON.stringify({ attemptId: input.attemptId }) });
    return { ...result, session: result.session ? toAuthSession(result.session) : undefined };
  },
  completeDeviceLogin: async () => {
    const result = await api<{ session: BrowserSession | null }>("/api/session");
    if (!result.session) throw new Error("QR sign-in did not complete.");
    return toAuthSession(result.session);
  },
  cancelDeviceLogin: (input) => api("/api/auth/qr/cancel", { method: "POST", body: JSON.stringify(input) }),
  logout: () => api("/api/logout", { method: "POST" }),
  logoutAll: () => api("/api/logout", { method: "POST" }),
  getSavedAccounts: async () => {
    const result = await api<{ session: BrowserSession | null }>("/api/session");
    return result.session ? [{
      userId: result.session.user.userId,
      displayName: result.session.user.displayName,
      email: result.session.user.email,
      avatarUrl: result.session.user.avatarUrl,
      membershipTier: result.session.user.membershipTier,
      providerCode: result.session.provider.code,
    }] : [];
  },
  switchAccount: async () => {
    const result = await api<{ session: BrowserSession | null }>("/api/session");
    if (!result.session) throw new Error("Saved account not found.");
    return toAuthSession(result.session);
  },
  removeAccount: () => api("/api/logout", { method: "POST" }),
  fetchSubscription: () => api("/api/subscription"),
  fetchPersistentStorageLocations: async () => ({ locations: [] }),
  resetPersistentStorage: async (input = {}) => ({ ok: true, storageRegion: input.storageRegion ?? null }),
  fetchGameAccountConnections: async () => ({ accounts: [], fetchedAt: Date.now() }),
  linkGameAccount: async () => { throw new Error("Account linking must be completed on the GeForce NOW website."); },
  unlinkGameAccount: async () => { throw new Error("Account unlinking must be completed on the GeForce NOW website."); },
  resyncGameAccount: async () => { throw new Error("Account syncing must be completed on the GeForce NOW website."); },
  fetchMainGames: async () => (await api<{ games: GameInfo[] }>("/api/catalog")).games,
  fetchStorePanels: async () => {
    const games = (await api<{ games: GameInfo[] }>("/api/catalog")).games;
    return [{ id: "web-catalog", title: "Featured", sections: [{ id: "featured", title: "Featured", games }] }];
  },
  fetchFeaturedGames: async () => (await api<{ games: GameInfo[] }>("/api/catalog")).games.slice(0, 20),
  fetchLibraryGames: async () => (await api<{ games: GameInfo[] }>("/api/library")).games,
  browseCatalog: (input) => api(`/api/catalog${input.searchQuery ? `?q=${encodeURIComponent(input.searchQuery)}` : ""}`),
  fetchPublicGames: () => api("/api/public-games"),
  resolveLaunchAppId: async (input) => (await api<{ appId: string | null }>("/api/resolve-launch-id", { method: "POST", body: JSON.stringify(input) })).appId,
  resolveStoreUrl: async (input) => (await api<{ url: string | null }>("/api/resolve-store-url", { method: "POST", body: JSON.stringify(input) })).url,
  markGameOwned: (input) => api("/api/mark-owned", { method: "POST", body: JSON.stringify(input) }),
  getPendingDirectLaunchRequest: async () => null,
  onDirectLaunchRequest: () => () => {},
  createSession: (input) => api("/api/stream/create", { method: "POST", body: JSON.stringify({ ...input, token: undefined, settings: { ...input.settings, clientMode: "web", transportMode: "webrtc" } }) }),
  pollSession: (input) => api("/api/stream/poll", { method: "POST", body: JSON.stringify({ ...input, token: undefined }) }),
  reportSessionAd: (input) => api("/api/stream/report-ad", { method: "POST", body: JSON.stringify({ ...input, token: undefined }) }),
  stopSession: (input) => api("/api/stream/stop", { method: "POST", body: JSON.stringify({ ...input, token: undefined }) }),
  getActiveSessions: async () => (await api<{ sessions: Awaited<ReturnType<OpenNowApi["getActiveSessions"]>> }>("/api/active-sessions")).sessions,
  claimSession: (input) => api("/api/stream/claim", { method: "POST", body: JSON.stringify({ ...input, token: undefined, settings: input.settings ? { ...input.settings, clientMode: "web", transportMode: "webrtc" } : undefined }) }),
  getNativeStreamerStatus: async () => createUnsupportedNativeStreamerStatus(),
  getNativeCloudGsyncCapabilities: async () => unsupportedNativeCloudGsyncCapabilities("Browser WebRTC mode"),
  showSessionConflictDialog: async () => "resume",
  connectSignaling,
  disconnectSignaling: async () => { if (socket?.readyState === WebSocket.OPEN) await sendSignal("disconnect"); socket?.close(); socket = null; },
  sendAnswer: (payload: SendAnswerRequest) => sendSignal("answer", payload),
  sendIceCandidate: (payload: IceCandidatePayload) => sendSignal("ice", payload),
  sendNativeInput: () => {},
  setNativeInputPaused: () => {},
  updateNativeRenderSurface: () => {},
  updateNativeShortcuts: () => {},
  requestKeyframe: (payload: KeyframeRequest) => sendSignal("keyframe", payload),
  onSignalingEvent: (listener) => { signalingListeners.add(listener); return () => signalingListeners.delete(listener); },
  onToggleFullscreen: () => () => {},
  onExitFullscreen: () => () => {},
  quitApp: async () => { location.assign("/"); },
  getUpdaterState: async () => updaterState,
  checkForUpdates: async () => updaterState,
  downloadUpdate: async () => updaterState,
  installUpdateAndRestart: async () => updaterState,
  onUpdaterStateChanged: () => () => {},
  setFullscreen: async (value) => { if (value && !document.fullscreenElement) await document.documentElement.requestFullscreen(); else if (!value && document.fullscreenElement) await document.exitFullscreen(); },
  toggleFullscreen: async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); },
  togglePointerLock: async () => { if (document.pointerLockElement) document.exitPointerLock(); else await document.documentElement.requestPointerLock(); },
  notifyPointerLockChange: () => {},
  readClipboardText: () => navigator.clipboard.readText(),
  getSettings: async () => readSettings(),
  setSetting: async (key, value) => { const settings = readSettings(); settings[key] = value; settings.streamClientMode = "web"; settings.transportMode = "webrtc"; writeSettings(settings); },
  resetSettings: async () => { const settings = { ...WEB_DEFAULT_SETTINGS }; writeSettings(settings); return settings; },
  selectNativeStreamerExecutable: async () => null,
  getMicrophonePermission: async () => ({ platform: "linux", isMacOs: false, status: "not-applicable", granted: false, canRequest: true, shouldUseBrowserApi: true }),
  exportLogs: async () => "OpenNOW Web logs are available in the browser developer console.",
  pingRegions: pingRegionsInBrowser,
  saveScreenshot: async (input) => {
    const id = crypto.randomUUID();
    const entry: ScreenshotEntry = { id, fileName: `${input.gameTitle ?? "OpenNOW"}-${Date.now()}.png`, filePath: id, createdAtMs: Date.now(), sizeBytes: input.dataUrl.length, dataUrl: input.dataUrl };
    screenshots.unshift(entry);
    return entry;
  },
  listScreenshots: async () => screenshots,
  deleteScreenshot: async (input) => { const index = screenshots.findIndex((item) => item.id === input.id); if (index >= 0) screenshots.splice(index, 1); },
  saveScreenshotAs: async (input) => { const item = screenshots.find((entry) => entry.id === input.id); if (!item) return { saved: false }; const anchor = document.createElement("a"); anchor.href = item.dataUrl; anchor.download = item.fileName; anchor.click(); return { saved: true, filePath: item.fileName }; },
  onTriggerScreenshot: () => () => {},
  onExternalEscape: () => () => {},
  openExternalUrl: async (url) => { const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported external URL."); window.open(parsed.toString(), "_blank", "noopener,noreferrer"); },
  beginRecording: async (input) => { const recordingId = crypto.randomUUID(); recordingChunks.set(recordingId, { mimeType: input.mimeType, chunks: [] }); return { recordingId }; },
  sendRecordingChunk: async (input) => { recordingChunks.get(input.recordingId)?.chunks.push(input.chunk); },
  finishRecording: async (input) => { const pending = recordingChunks.get(input.recordingId); if (!pending) throw new Error("Recording not found."); const blob = new Blob(pending.chunks, { type: pending.mimeType }); const entry: RecordingEntry = { id: input.recordingId, fileName: `${input.gameTitle ?? "OpenNOW"}-${Date.now()}.webm`, filePath: URL.createObjectURL(blob), createdAtMs: Date.now(), sizeBytes: blob.size, durationMs: input.durationMs, gameTitle: input.gameTitle, thumbnailDataUrl: input.thumbnailDataUrl }; recordings.unshift(entry); recordingChunks.delete(input.recordingId); return entry; },
  abortRecording: async (input) => { recordingChunks.delete(input.recordingId); },
  listRecordings: async () => recordings,
  deleteRecording: async (input) => { const index = recordings.findIndex((item) => item.id === input.id); if (index >= 0) { URL.revokeObjectURL(recordings[index].filePath); recordings.splice(index, 1); } },
  showRecordingInFolder: async () => {},
  listMediaByGame: async (input = {}) => ({ screenshots: screenshots.filter((item) => !input.gameTitle || item.fileName.includes(input.gameTitle)), videos: recordings.filter((item) => !input.gameTitle || item.gameTitle === input.gameTitle) }),
  getMediaThumbnail: async (input) => screenshots.find((item) => item.filePath === input.filePath)?.dataUrl ?? recordings.find((item) => item.filePath === input.filePath)?.thumbnailDataUrl ?? null,
  showMediaInFolder: async () => {},
  getMediaPlaybackUrl: async (input) => recordings.find((item) => item.filePath === input.filePath)?.filePath ?? null,
  deleteMediaFile: async (input) => { const index = recordings.findIndex((item) => item.filePath === input.filePath); if (index >= 0) recordings.splice(index, 1); return { ok: index >= 0 }; },
  regenMediaThumbnail: async (input) => ({ ok: true, thumbnailDataUrl: recordings.find((item) => item.filePath === input.filePath)?.thumbnailDataUrl ?? null }),
  deleteCache: async () => { localStorage.removeItem("opennow.catalog.snapshot.v1"); },
  fetchPrintedWasteQueue: async () => ({}),
  fetchPrintedWasteServerMapping: async () => ({}),
  getThanksData: async () => ({ contributors: [], supporters: [], contributorsError: "Community data is unavailable in this web build." }),
  provisionZortosCommunityProxy: async () => { throw new Error("Community proxy provisioning is unavailable in the hosted web app."); },
  setDiscordActivity: async () => {},
  clearDiscordActivity: async () => {},
  getReleaseHighlights: async (version = "0.5.1-web") => ({ version, title: `OpenNOW ${version}`, bodyMarkdown: "OpenNOW is now available in your browser.", source: "fallback" }),
  ackReleaseHighlights: async () => {},
  onReleaseHighlightsShow: () => () => {},
};

export function installBrowserBridge(): void {
  window.openNow = bridge;
}
