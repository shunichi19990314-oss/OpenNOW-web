import { ClipboardCheck, ClipboardCopy, FileDown } from "lucide-react";
import { useCallback, useEffect, useState, type JSX } from "react";

import type { Settings } from "@shared/gfn";

import { useTranslation } from "../i18n";
import {
  buildDiagnosticsReport,
  collectDiagnosticsEnvironment,
  copyOrDownload,
  downloadText,
  type DiagnosticsStreamSummary,
} from "../lib/diagnosticsReport";
import type { StreamDiagnostics } from "../platforms/gfn/webrtcClient";
import type { StreamDiagnosticsStore } from "../utils/streamDiagnosticsStore";

interface DiagnosticsSectionProps {
  showAll: boolean;
  settings: Settings;
  /** Live stream stats store; holds the last measured values after a session. */
  streamDiagnostics?: StreamDiagnosticsStore | null;
  appVersion?: string;
}

/** Short form of the version line, matching the desktop About page. */
const APP_VERSION = "0.1.0";

/** Settings keys that change streaming behaviour and matter for a report. */
function streamSettingsSnapshot(settings: Settings): Record<string, string | number | boolean> {
  return {
    resolution: settings.resolution,
    fps: settings.fps,
    codec: settings.codec,
    colorQuality: settings.colorQuality,
    maxBitrateMbps: settings.maxBitrateMbps,
    adaptiveBitrate: settings.adaptiveBitrate,
    decoderPreference: settings.decoderPreference,
    encoderPreference: settings.encoderPreference,
    streamClientMode: settings.streamClientMode,
    transportMode: settings.transportMode,
    enableL4S: settings.enableL4S,
    enableCloudGsync: settings.enableCloudGsync,
    nativeCursorOverlay: settings.nativeCursorOverlay,
    sessionProxyEnabled: settings.sessionProxyEnabled,
  };
}

function toStreamSummary(diagnostics: StreamDiagnostics): DiagnosticsStreamSummary | undefined {
  if (!diagnostics) return undefined;
  // A default snapshot (never connected) would describe a session that did not
  // happen, so it is left out entirely.
  if (diagnostics.connectionState === "new" && diagnostics.framesReceived === 0) return undefined;
  return {
    connectionState: diagnostics.connectionState,
    resolution: diagnostics.resolution || undefined,
    codec: diagnostics.codec || undefined,
    colorQuality: diagnostics.colorCodec || undefined,
    hardwareAcceleration: diagnostics.hardwareAcceleration || undefined,
    gpuType: diagnostics.gpuType || undefined,
    bitrateKbps: diagnostics.bitrateKbps,
    targetBitrateKbps: diagnostics.targetBitrateKbps,
    packetsLost: diagnostics.packetsLost,
    packetLossPercent: diagnostics.packetLossPercent,
    rttMs: diagnostics.rttMs,
    jitterMs: diagnostics.jitterMs,
    framesDropped: diagnostics.framesDropped,
    decodeTimeMs: diagnostics.decodeTimeMs,
    renderTimeMs: diagnostics.renderTimeMs,
    lagReason: diagnostics.lagReason,
    lagReasonDetail: diagnostics.lagReasonDetail,
  };
}

/**
 * "Copy diagnostics" row, matching the desktop About page's redacted export.
 *
 * The report is built client-side from browser capabilities plus the current
 * stream settings, so it can be pasted into a bug report without leaking an
 * account token, a proxy URL or the rig's address.
 */
export function DiagnosticsSection({
  showAll,
  settings,
  streamDiagnostics,
  appVersion = APP_VERSION,
}: DiagnosticsSectionProps): JSX.Element {
  const { t, locale } = useTranslation();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "downloaded" | "failed">("idle");

  useEffect(() => {
    if (copyState === "idle") return undefined;
    const timer = window.setTimeout(() => setCopyState("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const buildReport = useCallback(() => buildDiagnosticsReport({
    appVersion,
    locale,
    themePack: settings.themePack,
    environment: collectDiagnosticsEnvironment(),
    stream: streamDiagnostics ? toStreamSummary(streamDiagnostics.getSnapshot()) : undefined,
    streamSettings: streamSettingsSnapshot(settings),
  }), [appVersion, locale, settings, streamDiagnostics]);

  const handleCopy = useCallback(async (): Promise<void> => {
    const result = await copyOrDownload(buildReport(), `opennow-diagnostics-${Date.now()}.txt`);
    setCopyState(result);
  }, [buildReport]);

  const handleDownload = useCallback((): void => {
    const saved = downloadText(buildReport(), `opennow-diagnostics-${Date.now()}.txt`);
    setCopyState(saved ? "downloaded" : "failed");
  }, [buildReport]);

  const statusText = copyState === "copied"
    ? t("settings.diagnostics.copied")
    : copyState === "downloaded"
      ? t("settings.diagnostics.downloaded")
      : copyState === "failed"
        ? t("settings.diagnostics.failed")
        : null;

  return (
    <section className="settings-section">
      {showAll && <div className="settings-section-context">{t("settings.sections.about")}</div>}
      <div className="settings-section-header">
        <h2>{t("settings.diagnostics.title")}</h2>
        <span className="settings-hint">{t("settings.diagnostics.privacy")}</span>
      </div>
      <div className="settings-rows">
        <div className="settings-row">
          <label className="settings-label">
            {t("settings.diagnostics.copy")}
            <span className="settings-hint">{t("settings.diagnostics.copyHint")}</span>
          </label>
          <div className="settings-diagnostics-actions">
            <button type="button" className="settings-export-logs-btn" onClick={() => void handleCopy()}>
              {copyState === "copied" ? <ClipboardCheck size={16} /> : <ClipboardCopy size={16} />}
              {t("settings.diagnostics.copy")}
            </button>
            <button type="button" className="settings-export-logs-btn" onClick={handleDownload}>
              <FileDown size={16} />
              {t("settings.diagnostics.download")}
            </button>
          </div>
        </div>
        {statusText && (
          <p className={`settings-diagnostics-status settings-diagnostics-status--${copyState}`} role="status">
            {statusText}
          </p>
        )}
      </div>
    </section>
  );
}
