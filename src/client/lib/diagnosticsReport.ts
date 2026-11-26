/**
 * Redacted diagnostics report ("Copy diagnostics" in the desktop build's
 * About page, and the Diagnostics screen's export).
 *
 * The desktop client keeps a bounded, redacted breadcrumb log and exports it so
 * a bug report can be triaged without leaking personal data. The web client has
 * no log file, so the equivalent is a snapshot of the facts support actually
 * needs: build, browser capabilities, the stream settings that changed
 * behaviour, and (when a session ran) the last measured stream stats.
 *
 * Everything here is pure so the shape and the redaction rules are testable.
 */

export interface DiagnosticsEnvironment {
  userAgent: string;
  language: string;
  platform?: string;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  screen?: { width: number; height: number; devicePixelRatio: number };
  /** Result of `navigator.connection?.effectiveType`, when available. */
  connectionType?: string;
}

export interface DiagnosticsStreamSummary {
  resolution?: string;
  fps?: number;
  codec?: string;
  colorQuality?: string;
  bitrateKbps?: number;
  targetBitrateKbps?: number;
  packetsLost?: number;
  packetLossPercent?: number;
  rttMs?: number;
  jitterMs?: number;
  framesDropped?: number;
  decodeTimeMs?: number;
  renderTimeMs?: number;
  hardwareAcceleration?: string;
  gpuType?: string;
  connectionState?: string;
  lagReason?: string;
  lagReasonDetail?: string;
}

export interface DiagnosticsSessionSummary {
  /** Server region name (never the IP: it identifies the rig). */
  region?: string;
  /** Milliseconds from launch to a decoded frame, when measured. */
  timeToFirstFrameMs?: number;
  startedAtMs?: number;
  endedAtMs?: number;
  /** Raw CloudMatch error code from a failed launch, when there was one. */
  errorCode?: string;
}

export interface DiagnosticsReportInput {
  appVersion: string;
  builtAt?: string;
  locale: string;
  themePack?: string;
  environment: DiagnosticsEnvironment;
  stream?: DiagnosticsStreamSummary;
  session?: DiagnosticsSessionSummary;
  /** Settings that change streaming behaviour; never includes tokens. */
  streamSettings?: Record<string, string | number | boolean | null | undefined>;
}

/** Placeholder used wherever a value could identify the visitor. */
export const REDACTED = "[redacted]";

const MAX_VALUE_LENGTH = 160;

function safeValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  const text = String(value);
  if (text.trim().length === 0) return "-";
  // A pasted URL can carry credentials or a session token in its query string;
  // keep the shape and drop the rest.
  const withoutQuery = text.replace(/([?&][^=\s]+)=([^&\s]*)/g, `$1=${REDACTED}`);
  return withoutQuery.length > MAX_VALUE_LENGTH
    ? `${withoutQuery.slice(0, MAX_VALUE_LENGTH)}…`
    : withoutQuery;
}

/**
 * Drop the identifying part of a user agent.
 *
 * Support needs engine + version (the usual cause of a codec or WebRTC bug),
 * not the exact device string, which is a fingerprinting surface.
 */
export function summarizeUserAgent(userAgent: string): string {
  const browser = /(Edg|OPR|Chrome|Firefox|Safari)\/([\d.]+)/.exec(userAgent);
  const engine = /(AppleWebKit|Gecko|Chromium)\/([\d.]+)/.exec(userAgent);
  const parts: string[] = [];
  if (browser) parts.push(`${browser[1]} ${browser[2].split(".")[0]}`);
  if (engine) parts.push(`${engine[1]} ${engine[2].split(".")[0]}`);
  return parts.length > 0 ? parts.join(" · ") : REDACTED;
}

/** Server IPs are replaced by their region, which the session already carries. */
export function redactHost(value: string | undefined): string {
  if (!value) return "-";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return REDACTED;
  // IPv6 and host:port forms
  if (/^[0-9a-f:]+$/i.test(value) && value.includes(":")) return REDACTED;
  return safeValue(value);
}

function section(title: string): string {
  return `\n[${title}]`;
}

function line(label: string, value: unknown): string {
  return `${label}: ${safeValue(value)}`;
}

function formatDate(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "-";
  // Fixed locale/UTC so a report pasted into an issue reads the same for
  // everyone, regardless of the visitor's browser language.
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function durationSeconds(startedAtMs?: number, endedAtMs?: number): string {
  if (!startedAtMs || !endedAtMs || endedAtMs < startedAtMs) return "-";
  const seconds = Math.round((endedAtMs - startedAtMs) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function buildDiagnosticsReport(input: DiagnosticsReportInput): string {
  const { environment, stream, session, streamSettings } = input;
  const rows: string[] = [
    "OpenNOW Web diagnostics",
    "This report contains no account, token, or network address data.",
  ];

  rows.push(section("Build"));
  rows.push(line("Version", input.appVersion));
  if (input.builtAt) rows.push(line("Built", input.builtAt));
  rows.push(line("Locale", input.locale));
  rows.push(line("Theme pack", input.themePack ?? "nocturne"));

  rows.push(section("Browser"));
  rows.push(line("Engine", summarizeUserAgent(environment.userAgent)));
  rows.push(line("Language", environment.language));
  if (environment.platform) rows.push(line("Platform", environment.platform));
  if (environment.hardwareConcurrency) rows.push(line("CPU threads", environment.hardwareConcurrency));
  if (environment.deviceMemoryGb) rows.push(line("Device memory (GB)", environment.deviceMemoryGb));
  if (environment.screen) {
    rows.push(line(
      "Screen",
      `${environment.screen.width}x${environment.screen.height} @${environment.screen.devicePixelRatio}x`,
    ));
  }
  if (environment.connectionType) rows.push(line("Connection", environment.connectionType));

  if (streamSettings && Object.keys(streamSettings).length > 0) {
    rows.push(section("Stream settings"));
    for (const [key, value] of Object.entries(streamSettings).sort(([a], [b]) => a.localeCompare(b))) {
      rows.push(line(key, value));
    }
  }

  if (stream) {
    rows.push(section("Stream"));
    if (stream.connectionState) rows.push(line("Connection state", stream.connectionState));
    if (stream.resolution) rows.push(line("Resolution", stream.resolution));
    if (stream.fps) rows.push(line("FPS", stream.fps));
    if (stream.codec) rows.push(line("Codec", stream.codec));
    if (stream.colorQuality) rows.push(line("Colour quality", stream.colorQuality));
    if (stream.hardwareAcceleration) rows.push(line("Decoder", stream.hardwareAcceleration));
    if (stream.gpuType) rows.push(line("Rig GPU", stream.gpuType));
    if (stream.bitrateKbps !== undefined) {
      rows.push(line("Bitrate (kbps)", `${Math.round(stream.bitrateKbps)} / ${Math.round(stream.targetBitrateKbps ?? 0)}`));
    }
    if (stream.rttMs !== undefined) rows.push(line("RTT (ms)", Math.round(stream.rttMs)));
    if (stream.jitterMs !== undefined) rows.push(line("Jitter (ms)", Math.round(stream.jitterMs)));
    if (stream.packetLossPercent !== undefined) {
      rows.push(line("Packet loss", `${stream.packetLossPercent.toFixed(2)}% of ${stream.packetsLost ?? 0}`));
    }
    if (stream.framesDropped !== undefined) rows.push(line("Frames dropped", stream.framesDropped));
    if (stream.decodeTimeMs !== undefined) rows.push(line("Decode (ms)", stream.decodeTimeMs.toFixed(1)));
    if (stream.renderTimeMs !== undefined) rows.push(line("Render (ms)", stream.renderTimeMs.toFixed(1)));
    if (stream.lagReason) rows.push(line("Lag reason", `${stream.lagReason}${stream.lagReasonDetail ? ` — ${stream.lagReasonDetail}` : ""}`));
  }

  if (session) {
    rows.push(section("Last session"));
    rows.push(line("Region", session.region ? redactHost(session.region) : "-"));
    rows.push(line("Started", formatDate(session.startedAtMs)));
    rows.push(line("Duration", durationSeconds(session.startedAtMs, session.endedAtMs)));
    if (session.timeToFirstFrameMs !== undefined) {
      rows.push(line("Time to first frame (ms)", Math.round(session.timeToFirstFrameMs)));
    }
    if (session.errorCode) rows.push(line("Error code", session.errorCode));
  }

  return `${rows.join("\n")}\n`;
}

/** Collect what the browser exposes, defensively: every field is optional. */
export function collectDiagnosticsEnvironment(win: Window | undefined = typeof window === "undefined" ? undefined : window): DiagnosticsEnvironment {
  const navigatorLike = win?.navigator as (Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  }) | undefined;

  let screenInfo: DiagnosticsEnvironment["screen"];
  try {
    screenInfo = win?.screen
      ? {
          width: win.screen.width || 0,
          height: win.screen.height || 0,
          devicePixelRatio: win.devicePixelRatio || 1,
        }
      : undefined;
  } catch {
    screenInfo = undefined;
  }

  return {
    userAgent: navigatorLike?.userAgent ?? "",
    language: navigatorLike?.language ?? "",
    platform: navigatorLike?.platform || undefined,
    hardwareConcurrency: navigatorLike?.hardwareConcurrency || undefined,
    deviceMemoryGb: navigatorLike?.deviceMemory || undefined,
    connectionType: navigatorLike?.connection?.effectiveType || undefined,
    screen: screenInfo,
  };
}

/** Save text as a file, for when the clipboard is unavailable or refused. */
export function downloadText(
  text: string,
  fileName: string,
  documentLike: Document | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
  if (!documentLike) return false;
  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = documentLike.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    documentLike.body.appendChild(anchor);
    anchor.click();
    documentLike.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy text to the clipboard, falling back to a download when the Clipboard API
 * is unavailable (it needs a secure context plus permission).
 */
export async function copyOrDownload(
  text: string,
  fileName: string,
  documentLike: Document | undefined = typeof document === "undefined" ? undefined : document,
  navigatorLike: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Promise<"copied" | "downloaded" | "failed"> {
  try {
    if (navigatorLike?.clipboard?.writeText) {
      await navigatorLike.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    // Fall through to the download path.
  }
  return downloadText(text, fileName, documentLike) ? "downloaded" : "failed";
}
