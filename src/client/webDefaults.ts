import type { Settings } from "@shared/gfn";
import {
  DEFAULT_KEYBOARD_LAYOUT,
  DEFAULT_VIDEO_SHADER_SETTINGS,
  getDefaultStreamPreferences,
  supportedStreamResolutions,
} from "@shared/gfn";

const streamPreferences = getDefaultStreamPreferences();

export interface DeviceStreamProbe {
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  hardwareConcurrency: number;
}

/**
 * Pick first-run stream defaults from the device's panel and CPU budget.
 *
 * Streaming 1080p to a small panel (11.6" 1366x768 education Chromebooks such
 * as the ASUS CR11/CR12 Flip, tablets, phones) wastes decode/compositing work
 * and bandwidth on pixels the screen cannot show; 720p maps ~1:1 there and
 * keeps low-power N-series CPUs smooth. Entitlement still wins: if a chosen
 * default is not entitled, resolveEntitledStreamProfile substitutes it at
 * launch.
 */
export function chooseStreamDefaultsForDevice(probe: DeviceStreamProbe): {
  resolution: string;
  maxBitrateMbps: number;
} {
  const dpr = probe.devicePixelRatio > 0 ? probe.devicePixelRatio : 1;
  const longEdge = Math.max(probe.screenWidth, probe.screenHeight) * dpr;
  const shortEdge = Math.min(probe.screenWidth, probe.screenHeight) * dpr;
  const lowPowerCpu = probe.hardwareConcurrency > 0 && probe.hardwareConcurrency <= 4;
  const smallPanel = longEdge > 0 && longEdge <= 1600 && shortEdge <= 900;

  if (smallPanel) {
    // 720p60 H264 is transparent at 20-25 Mbps; keep extra headroom on
    // 4-core devices that also drive the browser UI and decode scaling.
    return { resolution: "1280x720", maxBitrateMbps: lowPowerCpu ? 20 : 25 };
  }
  if (lowPowerCpu) {
    return { resolution: "1920x1080", maxBitrateMbps: 30 };
  }
  // 40 Mbps carries 1080p60 comfortably without saturating typical home
  // Wi-Fi; launch-time clamping (lib/connectionBitrate) adapts on slow links.
  return { resolution: "1920x1080", maxBitrateMbps: 40 };
}

function probeDeviceForStreamDefaults(): DeviceStreamProbe {
  try {
    if (typeof window === "undefined" || !window.screen) {
      return { screenWidth: 0, screenHeight: 0, devicePixelRatio: 1, hardwareConcurrency: 0 };
    }
    return {
      screenWidth: window.screen.width || 0,
      screenHeight: window.screen.height || 0,
      devicePixelRatio: window.devicePixelRatio || 1,
      hardwareConcurrency: typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 0 : 0,
    };
  } catch {
    return { screenWidth: 0, screenHeight: 0, devicePixelRatio: 1, hardwareConcurrency: 0 };
  }
}

/**
 * Stream modes GeForce NOW actually accepts, read from the single source of
 * truth in `@shared/gfn/entitlements` (STREAM_MODE_PRESETS) so this list can
 * never drift from what the entitlement layer will match.
 */
const GFN_STREAM_RESOLUTIONS: readonly string[] = supportedStreamResolutions();

interface ResolutionSize {
  value: string;
  width: number;
  height: number;
  long: number;
  short: number;
}

function parseResolution(value: string): ResolutionSize | null {
  const [rawWidth, rawHeight] = value.split("x");
  const width = Number.parseInt(rawWidth ?? "", 10);
  const height = Number.parseInt(rawHeight ?? "", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    value,
    width,
    height,
    long: Math.max(width, height),
    short: Math.min(width, height),
  };
}

function fitsPanel(size: ResolutionSize, panelLong: number, panelShort: number): boolean {
  return size.long <= panelLong && size.short <= panelShort;
}

/**
 * Largest GFN-supported mode that still fits the panel, preferring the aspect
 * ratio of the original request so an automatic downgrade never silently turns
 * a 16:9 launch into a 16:10 one. Returns null when nothing supported fits
 * (very small or unreadable panel) so the caller can leave the request alone.
 */
function largestResolutionForPanel(
  requested: ResolutionSize,
  panelLong: number,
  panelShort: number,
): string | null {
  const requestedRatio = requested.long / requested.short;
  const fitting = GFN_STREAM_RESOLUTIONS
    .map(parseResolution)
    .filter((size): size is ResolutionSize => size !== null && fitsPanel(size, panelLong, panelShort));
  if (fitting.length === 0) return null;

  const sameAspectRatio = fitting.filter(
    (size) => Math.abs(size.long / size.short - requestedRatio) < 0.02,
  );
  const pool = sameAspectRatio.length > 0 ? sameAspectRatio : fitting;
  let best = pool[0];
  for (const size of pool) {
    if (size.width * size.height > best.width * best.height) best = size;
  }
  return best.value;
}

/**
 * Right-size a requested stream resolution to the display that will actually
 * show it, without ever touching the user's stored preference.
 *
 * Requesting more pixels than the panel can display (e.g. a stale 1920x1080
 * setting carried onto a 1366x768 Chromebook) buys nothing visually — the panel
 * downscales the result — while still costing decode work, bandwidth and
 * latency on the link. On low-power hardware over a long-haul route (the free
 * tier streams from US rigs) that extra load shows up as stutter. When the
 * request already fits the panel we respect it verbatim (including deliberate
 * 1:1 native-panel choices); only an oversized request falls back to the
 * device-appropriate default from chooseStreamDefaultsForDevice.
 *
 * The active display is read from window.screen, so connecting an external
 * monitor raises the ceiling automatically. An unknown/failed probe leaves the
 * request untouched rather than guessing.
 */
export function fitResolutionToDisplay(
  requested: string,
  probe: DeviceStreamProbe = probeDeviceForStreamDefaults(),
): string {
  const dpr = probe.devicePixelRatio > 0 ? probe.devicePixelRatio : 1;
  const panelLong = Math.max(probe.screenWidth, probe.screenHeight) * dpr;
  const panelShort = Math.min(probe.screenWidth, probe.screenHeight) * dpr;
  // Unknown display (SSR, probe failure): never guess, keep the request.
  if (panelLong <= 0 || panelShort <= 0) {
    return requested;
  }

  const requestedSize = parseResolution(requested);
  if (requestedSize === null) {
    return requested;
  }
  // Fits within the panel: honor the explicit choice.
  if (fitsPanel(requestedSize, panelLong, panelShort)) {
    return requested;
  }

  // Oversized for this display: fall back to the device-appropriate default
  // (e.g. 720p on a small panel).
  const deviceDefault = parseResolution(chooseStreamDefaultsForDevice(probe).resolution);
  if (deviceDefault !== null && fitsPanel(deviceDefault, panelLong, panelShort)) {
    return deviceDefault.value;
  }

  // That default is sized for common 16:9 panels, so on an unusual display it
  // can itself be larger than the glass — a 1680x1050 monitor is not "small"
  // (long edge > 1600) yet cannot show 1920x1080, and a 4:3 1024x768 panel
  // cannot show 1280x720. Handing back a value that still does not fit would
  // defeat the whole point, so step down to the largest supported mode that does.
  return largestResolutionForPanel(requestedSize, panelLong, panelShort) ?? requested;
}

export const DEVICE_STREAM_DEFAULTS = chooseStreamDefaultsForDevice(probeDeviceForStreamDefaults());

export const WEB_DEFAULT_SETTINGS: Settings = {
  resolution: DEVICE_STREAM_DEFAULTS.resolution,
  aspectRatio: "16:9",
  posterSizeScale: 1.05,
  fps: 60,
  maxBitrateMbps: DEVICE_STREAM_DEFAULTS.maxBitrateMbps,
  recordingBitrateMbps: null,
  streamClientMode: "web",
  nativeStreamerBackend: "gstreamer",
  nativeVideoBackend: "auto",
  nativeStreamerExecutablePath: "",
  nativeCloudGsyncMode: "auto",
  nativeD3dFullscreenMode: "auto",
  nativeExternalRenderer: false,
  transportMode: "webrtc",
  showNativeStreamerStats: false,
  codec: streamPreferences.codec,
  decoderPreference: "auto",
  encoderPreference: "auto",
  colorQuality: streamPreferences.colorQuality,
  region: "",
  sessionProxyEnabled: false,
  sessionProxyUrl: "",
  clipboardPaste: false,
  enableGyroscopeControls: false,
  steamControllerCompatibilityMode: false,
  nativeCursorOverlay: true,
  mouseSensitivity: 1,
  mouseAcceleration: 1,
  shortcutToggleStats: "F3",
  shortcutTogglePointerLock: "F8",
  shortcutToggleFullscreen: "F10",
  shortcutStopStream: "Ctrl+Shift+Q",
  shortcutToggleAntiAfk: "Ctrl+Shift+K",
  shortcutToggleMicrophone: "Ctrl+Shift+M",
  shortcutScreenshot: "F11",
  shortcutToggleRecording: "F12",
  microphoneMode: "disabled",
  microphoneDeviceId: "",
  hideStreamButtons: false,
  showAntiAfkIndicator: true,
  showStatsOnLaunch: false,
  hideServerSelector: false,
  appAccentColor: "green",
  appTheme: "auto",
  translucentUI: false,
  controllerMode: false,
  launchInConsoleMode: false,
  autoFullScreen: false,
  favoriteGameIds: [],
  sessionCounterEnabled: false,
  showSessionTimeRemainingInStatsOverlay: false,
  sessionClockShowEveryMinutes: 60,
  sessionClockShowDurationSeconds: 30,
  windowWidth: 1400,
  windowHeight: 900,
  keyboardLayout: DEFAULT_KEYBOARD_LAYOUT,
  gameLanguage: "en_US",
  enablePersistingInGameSettings: false,
  enableL4S: false,
  enableCloudGsync: false,
  nativeTransitionDiagnostics: undefined,
  discordRichPresence: false,
  queueNotifications: true,
  adaptiveBitrate: true,
  touchGamepadEnabled: false,
  autoCheckForUpdates: false,
  updateChannel: "stable",
  allowEscapeToExitFullscreen: false,
  lastSeenReleaseHighlightsVersion: "0.5.1-web",
  videoShader: { ...DEFAULT_VIDEO_SHADER_SETTINGS },
};
