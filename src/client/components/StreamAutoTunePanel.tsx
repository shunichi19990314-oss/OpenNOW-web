import { Gauge, Sparkles, TriangleAlert, Check } from "lucide-react";
import { useCallback, useMemo, useState, type JSX } from "react";
import { m } from "motion/react";

import type { StreamRegion } from "@shared/gfn";

import { useTranslation } from "../i18n";
import { readNavigatorConnection } from "../lib/connectionBitrate";
import { runConnectionTest, type ConnectionTestReport } from "../lib/connectionTest";
import type { CodecTestResult } from "../lib/codecDiagnostics";
import {
  buildStreamTuningPlan,
  gradeTranslationKey,
  limitingFactorTranslationKey,
  summarizeConnectionQuality,
  type StreamTuningPlan,
  type TuningChange,
  type TuningCurrentSettings,
} from "../lib/streamAutoTune";
import { panelSpring } from "./MotionProvider";
import { MotionSpinner } from "./MotionSpinner";

export interface StreamAutoTunePanelProps {
  regions: StreamRegion[];
  selectedRegionUrl: string | null;
  codecResults: CodecTestResult[] | null;
  current: TuningCurrentSettings;
  /** Applies one accepted change; called once per changed field. */
  onApply: (changes: TuningChange[]) => void;
  /** Optional probe override (tests / non-browser shells). */
  probeDevice?: () => { screenWidth: number; screenHeight: number; devicePixelRatio: number; hardwareConcurrency: number };
}

type Phase = "idle" | "running" | "done" | "error";

function defaultProbe(): { screenWidth: number; screenHeight: number; devicePixelRatio: number; hardwareConcurrency: number } {
  if (typeof window === "undefined" || !window.screen) {
    return { screenWidth: 0, screenHeight: 0, devicePixelRatio: 1, hardwareConcurrency: 0 };
  }
  return {
    screenWidth: window.screen.width || 0,
    screenHeight: window.screen.height || 0,
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 0 : 0,
  };
}

function codecSupportFrom(results: CodecTestResult[] | null): { h264: boolean; h264Hardware: boolean; hevc: boolean; av1: boolean } {
  if (!results || results.length === 0) {
    // Without a measurement, assume the compatibility floor only: never
    // recommend a codec we cannot prove this browser can decode.
    return { h264: true, h264Hardware: false, hevc: false, av1: false };
  }
  const find = (codec: string) => results.find((entry) => entry.codec.toLowerCase() === codec.toLowerCase());
  const usable = (codec: string): boolean => {
    const entry = find(codec);
    return Boolean(entry?.webrtcSupported && entry?.decodeSupported);
  };
  return {
    h264: usable("H264") || !find("H264"),
    h264Hardware: Boolean(find("H264")?.hwAccelerated),
    hevc: usable("H265"),
    av1: usable("AV1"),
  };
}

/**
 * One-click "tune my stream" panel for the video settings section.
 *
 * Reuses the existing connection test probes, adds the device panel and codec
 * capability dimensions the test alone ignores, and shows a review step: the
 * visitor sees each field that would change and can apply them together. If a
 * probe fails the panel says so instead of guessing.
 */
export function StreamAutoTunePanel({
  regions,
  selectedRegionUrl,
  codecResults,
  current,
  onApply,
  probeDevice = defaultProbe,
}: StreamAutoTunePanelProps): JSX.Element {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [report, setReport] = useState<ConnectionTestReport | null>(null);
  const [plan, setPlan] = useState<StreamTuningPlan | null>(null);
  const [applied, setApplied] = useState(false);

  const run = useCallback(async () => {
    if (phase === "running") return;
    setPhase("running");
    setApplied(false);
    setPlan(null);
    try {
      const result = await runConnectionTest({
        regions,
        selectedRegionUrl,
        onProgress: (partial) => setReport({ ...partial }),
      });
      setReport(result);
      const quality = summarizeConnectionQuality(
        { latency: result.latency, throughput: result.throughput, webrtc: result.webrtc },
        regions,
      );
      setPlan(buildStreamTuningPlan({
        device: probeDevice(),
        quality,
        codec: codecSupportFrom(codecResults),
        current,
        connection: readNavigatorConnection(),
      }));
      setPhase("done");
    } catch (error) {
      console.warn("[StreamAutoTune] Connection test failed:", error);
      setPhase("error");
    }
  }, [codecResults, current, phase, probeDevice, regions, selectedRegionUrl]);

  const qualityLabel = useMemo(() => {
    if (!plan) return null;
    return t(gradeTranslationKey(plan.quality.grade));
  }, [plan, t]);

  const apply = () => {
    if (!plan || plan.changes.length === 0) return;
    onApply(plan.changes);
    setApplied(true);
  };

  return (
    <div className="stream-auto-tune">
      <div className="stream-auto-tune-head">
        <div className="stream-auto-tune-title">
          <Sparkles size={16} aria-hidden="true" />
          <span>{t("streamTuning.title")}</span>
        </div>
        <span className="settings-hint">{t("streamTuning.description")}</span>
      </div>

      <div className="stream-auto-tune-actions">
        <button
          type="button"
          className="settings-action-button"
          onClick={() => {
            void run();
          }}
          disabled={phase === "running"}
        >
          {phase === "running" ? (
            <>
              <MotionSpinner size={14} label={t("streamTuning.running")} />
              {t("streamTuning.running")}
            </>
          ) : (
            <>
              <Gauge size={14} aria-hidden="true" />
              {phase === "idle" ? t("streamTuning.run") : t("streamTuning.rerun")}
            </>
          )}
        </button>
      </div>

      {phase === "error" && (
        <p className="stream-auto-tune-note stream-auto-tune-note--warn">
          <TriangleAlert size={14} aria-hidden="true" />
          {t("streamTuning.failed")}
        </p>
      )}

      {plan && (
        <m.div
          className="stream-auto-tune-result"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={panelSpring}
        >
          <div className={`stream-auto-tune-grade grade-${plan.quality.grade}`}>
            <span className="stream-auto-tune-grade-value">{qualityLabel}</span>
            <span className="stream-auto-tune-grade-score">{t("streamTuning.score", { score: plan.quality.score })}</span>
          </div>

          <ul className="stream-auto-tune-metrics">
            <li>
              <span>{t("settings.connectionTest.latency")}</span>
              <strong>
                {plan.quality.latencyMs !== null
                  ? t("settings.connectionTest.latencyValue", {
                    ms: Math.round(plan.quality.latencyMs),
                    region: report?.latency?.regionName ?? "",
                  })
                  : t("streamTuning.unavailable")}
              </strong>
            </li>
            <li>
              <span>{t("settings.connectionTest.throughput")}</span>
              <strong>
                {plan.quality.throughputMbps !== null
                  ? t("settings.connectionTest.throughputValue", { mbps: plan.quality.throughputMbps.toFixed(1) })
                  : t("streamTuning.unavailable")}
              </strong>
            </li>
            <li>
              <span>{t("settings.connectionTest.webrtc")}</span>
              <strong>
                {plan.quality.udpAvailable
                  ? t("streamTuning.udpOk")
                  : t("streamTuning.udpTcpFallback")}
              </strong>
            </li>
            <li>
              <span>{t("streamTuning.limiting")}</span>
              <strong>{t(limitingFactorTranslationKey(plan.quality.limitingFactor))}</strong>
            </li>
          </ul>

          {plan.changes.length === 0 ? (
            <p className="stream-auto-tune-note stream-auto-tune-note--ok">
              <Check size={14} aria-hidden="true" />
              {t("streamTuning.alreadyOptimal")}
            </p>
          ) : (
            <>
              <div className="stream-auto-tune-changes">
                <div className="stream-auto-tune-changes-label">{t("streamTuning.changesTitle")}</div>
                <ul>
                  {plan.changes.map((change) => (
                    <li key={change.key}>
                      <span className="stream-auto-tune-change-key">{t(`streamTuning.fields.${change.key}`)}</span>
                      <span className="stream-auto-tune-change-values">
                        <s>{change.from}</s>
                        <span aria-hidden="true">→</span>
                        <strong>{change.to}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="stream-auto-tune-apply">
                <button type="button" className="settings-action-button" onClick={apply} disabled={applied}>
                  {applied ? t("streamTuning.applied") : t("streamTuning.apply")}
                </button>
                <span className="settings-hint">
                  {applied
                    ? t("streamTuning.appliedHint")
                    : t("streamTuning.applyHint", { count: plan.changes.length })}
                </span>
              </div>
            </>
          )}
        </m.div>
      )}

      <details className="stream-auto-tune-details">
        <summary>{t("streamTuning.howItWorks")}</summary>
        <p>{t("streamTuning.howItWorksBody")}</p>
        <p className="stream-auto-tune-details-current">
          {t("streamTuning.currentProfile", {
            resolution: current.resolution,
            fps: current.fps,
            bitrate: current.maxBitrateMbps === 0 ? t("app.labels.auto") : current.maxBitrateMbps,
            codec: current.codec,
            color: current.colorQuality,
          })}
        </p>
      </details>
    </div>
  );
}
