import { useMemo, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { JSX } from "react";
import type { StreamLagReason } from "../platforms/gfn/webrtcClient";
import type { StreamDiagnosticsStore } from "../utils/streamDiagnosticsStore";
import { useStreamDiagnosticsStore } from "../utils/streamDiagnosticsStore";
import {
  getBitratePerformanceColor,
  getInputQueueColor,
  getPacketLossColor,
  getRttColor,
  getTimingColor,
} from "../utils/streamDiagnosticsFormat";
import { panelSpring, smoothEase, surfaceRevealTransition } from "./MotionProvider";
import { useTranslation } from "../i18n";

function getLagReasonLabel(reason: StreamLagReason): string {
  switch (reason) {
    case "network":
      return "stream.stats.lagReasons.network";
    case "decoder":
      return "stream.stats.lagReasons.decode";
    case "input_backpressure":
      return "stream.stats.lagReasons.input";
    case "render":
      return "stream.stats.lagReasons.render";
    case "stable":
      return "stream.stats.lagReasons.stable";
    default:
      return "stream.stats.lagReasons.unknown";
  }
}

function getLagReasonColor(reason: StreamLagReason): string {
  switch (reason) {
    case "network":
    case "decoder":
      return "var(--error)";
    case "input_backpressure":
    case "render":
      return "var(--warning)";
    case "stable":
      return "var(--success)";
    default:
      return "var(--ink-muted)";
  }
}

export interface StreamStatsHudProps {
  diagnosticsStore: StreamDiagnosticsStore;
  gstreamerEnabled: boolean;
  serverRegion?: string;
  sessionTimeRemainingText: string | null;
  hintsVisible?: boolean;
}

export function StreamStatsHud({
  diagnosticsStore,
  gstreamerEnabled,
  serverRegion,
  sessionTimeRemainingText,
  hintsVisible = false,
}: StreamStatsHudProps): JSX.Element {
  const { t } = useTranslation();
  const stats = useStreamDiagnosticsStore(diagnosticsStore);
  const [expanded, setExpanded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const hasLiveBitrate = stats.bitrateKbps > 0;
  const bitrateKbps = hasLiveBitrate ? stats.bitrateKbps : stats.targetBitrateKbps;
  const bitrateMbps = bitrateKbps > 0 ? (bitrateKbps / 1000).toFixed(1) : "--";
  const bitrateLabel = hasLiveBitrate
    ? `${bitrateMbps} Mbps`
    : stats.targetBitrateKbps > 0
      ? t("stream.stats.targetBitrate", { mbps: bitrateMbps })
      : "-- Mbps";
  const bitratePerformancePercent =
    stats.targetBitrateKbps > 0 && stats.bitrateKbps > 0
      ? (stats.bitrateKbps / stats.targetBitrateKbps) * 100
      : 0;
  const bitratePerformanceText =
    bitratePerformancePercent > 0 ? `${bitratePerformancePercent.toFixed(0)}%` : "--";
  const bitratePerformanceColor = getBitratePerformanceColor(bitratePerformancePercent);
  const hasResolution = stats.nativeRendererActive || stats.resolution !== "";
  const displayFps = Math.max(stats.decodeFps, stats.renderFps);
  const primaryText = hasResolution
    ? `${stats.resolution || t("stream.stats.nativeRenderer")}${displayFps > 0 ? ` · ${displayFps}fps` : ""}`
    : t("stream.stats.connecting");
  const hasCodec = Boolean(stats.codec && stats.codec !== "");
  const regionLabel = stats.serverRegion || serverRegion || "";
  const decodeColor = getTimingColor(stats.decodeTimeMs, 8, 16);
  const renderColor = getTimingColor(stats.renderTimeMs, 12, 22);
  const jitterBufferColor = getTimingColor(stats.jitterBufferDelayMs, 10, 24);
  const lossColor = getPacketLossColor(stats.packetLossPercent);
  const lossLabel = stats.nativeRendererActive ? t("stream.stats.drop") : t("stream.stats.loss");
  const lossTitle = stats.nativeRendererActive
    ? t("stream.stats.nativeDropHint")
    : t("stream.stats.packetLoss");
  const dText = stats.decodeTimeMs > 0 ? `${stats.decodeTimeMs.toFixed(1)}ms` : "--";
  const rText = stats.renderTimeMs > 0 ? `${stats.renderTimeMs.toFixed(1)}ms` : "--";
  const jbText = stats.jitterBufferDelayMs > 0 ? `${stats.jitterBufferDelayMs.toFixed(1)}ms` : "--";
  const inputLive = stats.inputReady && stats.connectionState === "connected";
  const inputQueueColor = getInputQueueColor(stats.inputQueueBufferedBytes, stats.inputQueueDropCount);
  const inputQueueText = `${(stats.inputQueueBufferedBytes / 1024).toFixed(1)}KB`;
  const partiallyReliableQueueText = `${(stats.partiallyReliableInputQueueBufferedBytes / 1024).toFixed(1)}KB`;
  const mouseResidualText = `${stats.mouseResidualMagnitude.toFixed(2)}px`;
  const rttColor = getRttColor(stats.rttMs);
  const rttText = stats.rttMs > 0 ? `${stats.rttMs.toFixed(0)}ms` : "--";
  const hasLagIssue = stats.lagReason !== "stable" && stats.lagReason !== "unknown";
  const hasPacketLoss = stats.packetLossPercent > 0;
  const hasIssues = hasLagIssue || hasPacketLoss;

  const advancedLines = useMemo(() => {
    const lines: string[] = [];
    // The expanded overlay is user-visible text, so even these diagnostics lines
    // are translated; only units (KB/ms/px) and product names stay as-is.
    lines.push(
      t("stream.stats.advancedInputQueue", {
        peak: (stats.inputQueuePeakBufferedBytes / 1024).toFixed(1),
        prPeak: (stats.partiallyReliableInputQueuePeakBufferedBytes / 1024).toFixed(1),
        drops: stats.inputQueueDropCount,
        sched: stats.inputQueueMaxSchedulingDelayMs.toFixed(1),
        residual: mouseResidualText,
      }),
    );
    lines.push(
      gstreamerEnabled
        ? t("stream.stats.advancedGstreamerOn", {
            state: stats.nativeRendererActive ? t("stream.stats.inUse") : t("stream.stats.notActive"),
          })
        : t("stream.stats.advancedGstreamerOff"),
    );
    const hwLine = [stats.hardwareAcceleration, stats.colorCodec].filter(Boolean).join(" · ");
    if (hwLine) lines.push(hwLine);
    if (stats.decoderPressureActive || stats.decoderRecoveryAttempts > 0) {
      lines.push(
        t("stream.stats.advancedDecoderRecovery", {
          state: stats.decoderPressureActive ? t("stream.stats.active") : t("stream.stats.idle"),
          attempts: stats.decoderRecoveryAttempts,
          action: stats.decoderRecoveryAction,
        }),
      );
    }
    if (stats.nativeTransitionSummary || stats.nativeQueueMode || stats.nativeCapsFramerate) {
      const none = t("stream.stats.none");
      const extras = [
        typeof stats.nativeRequestedFps === "number"
          ? t("stream.stats.advancedRequested", { value: stats.nativeRequestedFps })
          : "",
        typeof stats.nativeFramesPendingToPresent === "number"
          ? t("stream.stats.advancedPending", { value: stats.nativeFramesPendingToPresent })
          : "",
        typeof stats.nativePartialFlushCount === "number" || typeof stats.nativeCompleteFlushCount === "number"
          ? t("stream.stats.advancedFlush", { partial: stats.nativePartialFlushCount ?? 0, complete: stats.nativeCompleteFlushCount ?? 0 })
          : "",
      ].filter(Boolean).join(" · ");
      lines.push(
        t("stream.stats.advancedNativeTransition", {
          summary: stats.nativeTransitionSummary ?? none,
          queue: stats.nativeQueueMode ?? t("stream.stats.unknown"),
          caps: stats.nativeCapsFramerate ?? t("stream.stats.unknown"),
          extras,
        }),
      );
    }
    if (stats.nativeRequestedStreamingFeaturesSummary || stats.nativeFinalizedStreamingFeaturesSummary) {
      lines.push(
        t("stream.stats.advancedStreamFeatures", {
          requested: stats.nativeRequestedStreamingFeaturesSummary ?? t("stream.stats.none"),
          finalized: stats.nativeFinalizedStreamingFeaturesSummary ?? t("stream.stats.none"),
        }),
      );
    }
    const gpuRegion = [stats.gpuType, regionLabel].filter(Boolean).join(" · ");
    if (gpuRegion) lines.push(gpuRegion);
    if (hasLagIssue) {
      lines.push(t("stream.stats.lagSourceLine", { reason: t(getLagReasonLabel(stats.lagReason)).toLowerCase(), detail: stats.lagReasonDetail }));
    }
    return lines;
  }, [
    gstreamerEnabled,
    hasLagIssue,
    mouseResidualText,
    regionLabel,
    stats,
  ]);

  return (
    <m.aside
      className={[
        "sv-stats",
        expanded ? "sv-stats--expanded" : "",
        hasIssues ? "sv-stats--warn" : "",
        hintsVisible ? "sv-stats--hints" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      initial={{ opacity: 0, x: -14, y: 10 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: -10, y: 6 }}
      transition={surfaceRevealTransition}
      layout
      aria-label={t("stream.stats.overlayLabel")}
    >
      <button
        type="button"
        className="sv-stats-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        title={expanded ? t("stream.stats.collapse") : t("stream.stats.expand")}
      >
        <div className="sv-stats-toggle-main">
          <p className="sv-stats-primary">{primaryText}</p>
          <div className="sv-stats-toggle-meta">
            <span className="sv-stats-kpi">
              <span className="sv-stats-kpi-label">{t("stream.stats.rtt")}</span>
              <span className="sv-stats-kpi-val sv-stats-kpi-val--rtt" style={{ color: rttColor }}>
                {rttText}
              </span>
            </span>
            <span className="sv-stats-kpi-divider" aria-hidden />
            <span className="sv-stats-kpi">
              <span className="sv-stats-kpi-label">{t("stream.stats.bitrateShort")}</span>
              <span className="sv-stats-kpi-val">{bitrateLabel}</span>
            </span>
          </div>
        </div>

        <div className="sv-stats-toggle-trail">
          <span className={`sv-stats-live ${inputLive ? "is-live" : "is-pending"}`}>
            {inputLive ? t("stream.stats.live") : t("stream.stats.sync")}
          </span>
          {hasIssues && (
            <m.span
              className="sv-stats-alert-dot"
              aria-hidden
              animate={{ opacity: [0.6, 1, 0.6], scale: [0.94, 1.06, 0.94] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            >
              <AlertTriangle size={11} />
            </m.span>
          )}
          <m.span
            className="sv-stats-chevron"
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.22, ease: smoothEase }}
            aria-hidden
          >
            <ChevronDown size={14} />
          </m.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {hasIssues && !expanded && (
          <m.div
            key="warn-strip"
            className="sv-stats-warn-strip"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: smoothEase }}
          >
            {hasPacketLoss && (
              <span className="sv-stats-warn-pill">
                {t("stream.stats.packetLossValue", { value: stats.packetLossPercent.toFixed(1) })}
              </span>
            )}
            {hasLagIssue && (
              <span className="sv-stats-warn-pill" title={stats.lagReasonDetail}>
                {t(getLagReasonLabel(stats.lagReason))}
              </span>
            )}
          </m.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            key="details"
            className="sv-stats-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={panelSpring}
          >
            <div className="sv-stats-details-inner">
              <div className="sv-stats-sub">
                <span className="sv-stats-sub-left">
                  {hasCodec ? stats.codec : "N/A"}
                  {stats.isHdr && <span className="sv-stats-hdr">HDR</span>}
                </span>
                {sessionTimeRemainingText && (
                  <span className="sv-stats-chip sv-stats-chip--time" title={t("sidebar.sessionTimeRemainingTitle")}>
                    {t("stream.stats.timeRemainingShort")}{" "}
                    <span className="sv-stats-chip-val">{sessionTimeRemainingText}</span>
                  </span>
                )}
              </div>

              <div className="sv-stats-metrics">
                <span className="sv-stats-chip" title={t("stream.stats.roundTripLatency")}>
                  {t("stream.stats.rtt")}{" "}
                  <span className="sv-stats-chip-val" style={{ color: rttColor }}>
                    {rttText}
                  </span>
                </span>
                <span className="sv-stats-chip" title={t("stream.stats.decodeTime")}>
                  {t("stream.stats.decodeShort")} <span className="sv-stats-chip-val" style={{ color: decodeColor }}>{dText}</span>
                </span>
                <span className="sv-stats-chip" title={t("stream.stats.renderTime")}>
                  {t("stream.stats.renderShort")} <span className="sv-stats-chip-val" style={{ color: renderColor }}>{rText}</span>
                </span>
                <span className="sv-stats-chip" title={t("stream.stats.jitterBuffer")}>
                  {t("stream.stats.jitterBufferShort")} <span className="sv-stats-chip-val" style={{ color: jitterBufferColor }}>{jbText}</span>
                </span>
                <span className="sv-stats-chip" title={lossTitle}>
                  {lossLabel}{" "}
                  <span className="sv-stats-chip-val" style={{ color: lossColor }}>
                    {stats.packetLossPercent.toFixed(2)}%
                  </span>
                </span>
                <span className="sv-stats-chip" title={t("stream.stats.bitratePerformance")}>
                  {t("stream.stats.bitrateShort")}{" "}
                  <span className="sv-stats-chip-val" style={{ color: bitratePerformanceColor }}>
                    {bitratePerformanceText}
                  </span>
                </span>
                <span className="sv-stats-chip" title={t("stream.stats.inputQueuePressure")}>
                  {t("stream.stats.inputQueueShort")}{" "}
                  <span className="sv-stats-chip-val" style={{ color: inputQueueColor }}>
                    {inputQueueText}
                  </span>
                </span>
                <span className="sv-stats-chip" title={t("stream.stats.inputChannelState")}>
                  {t("stream.stats.partiallyReliableShort")}{" "}
                  <span
                    className="sv-stats-chip-val"
                    style={{ color: stats.partiallyReliableInputOpen ? "var(--success)" : "var(--ink-muted)" }}
                  >
                    {stats.partiallyReliableInputOpen
                      ? `${stats.mouseMoveTransport === "partially_reliable" ? t("stream.stats.transportMouse") : t("stream.stats.transportOpen")} · ${partiallyReliableQueueText}`
                      : t("stream.stats.off")}
                  </span>
                </span>
                <span className="sv-stats-chip" title={t("stream.stats.mouseFlushCadence")}>
                  {t("stream.stats.mouseFlushShort")}{" "}
                  <span
                    className="sv-stats-chip-val"
                    style={{ color: stats.mouseAdaptiveFlushActive ? "var(--warning)" : "var(--success)" }}
                  >
                    {stats.mouseFlushIntervalMs.toFixed(0)}ms · {t("stream.stats.perSecond", { value: stats.mousePacketsPerSecond })}
                  </span>
                </span>
                {hasLagIssue && (
                  <span className="sv-stats-chip sv-stats-chip--warn" title={stats.lagReasonDetail}>
                    {t("stream.stats.lagShort")}{" "}
                    <span className="sv-stats-chip-val" style={{ color: getLagReasonColor(stats.lagReason) }}>
                      {t(getLagReasonLabel(stats.lagReason))}
                    </span>
                  </span>
                )}
              </div>

              {advancedLines.length > 0 && (
                <div className="sv-stats-advanced">
                  <button
                    type="button"
                    className="sv-stats-advanced-toggle"
                    onClick={() => setAdvancedOpen((value) => !value)}
                    aria-expanded={advancedOpen}
                  >
                    {advancedOpen ? t("stream.stats.hideAdvanced") : t("stream.stats.showAdvanced")}
                  </button>
                  <AnimatePresence initial={false}>
                    {advancedOpen && (
                      <m.div
                        key="advanced"
                        className="sv-stats-advanced-body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.26, ease: smoothEase }}
                      >
                        {advancedLines.map((line) => (
                          <p key={line} className="sv-stats-foot">
                            {line}
                          </p>
                        ))}
                      </m.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </m.aside>
  );
}
