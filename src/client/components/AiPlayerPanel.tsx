import { memo, useCallback, useEffect, useRef, useState, type JSX } from "react";

import { useTranslation } from "../i18n";
import {
  AI_PLAYER_SUGGESTED_MODELS,
  type AiPlayerDecision,
  type AiPlayerStatus,
} from "../../shared/aiPlayer";
import {
  runAiPlayerLoop,
  type AiPlayerInputSink,
  type AiPlayerLogCode,
  type AiPlayerLoopState,
  type AiPlayerLogEntry,
} from "../lib/aiPlayerLoop";

export interface AiPlayerPanelProps {
  gameTitle: string;
  /** Epoch ms when the session started, or null before a stream exists. */
  sessionStartedAtMs: number | null;
  sink: AiPlayerInputSink | null;
  /** Actions offered to the model, from the gamepad action table. */
  actionNames: string[];
  /** False while connecting or after the stream ended. */
  enabled?: boolean;
}

const DEFAULT_LOG_LIMIT = 40;

/**
 * Small overlay that starts and stops the AI player.
 *
 * Deliberately outside the stream video element: the pointer-lock surface owns
 * mouse input, and a panel inside it would either be unclickable or steal the
 * lock. It sits in the corner and only intercepts clicks on itself.
 */
export const AiPlayerPanel = memo(function AiPlayerPanel({
  gameTitle,
  sessionStartedAtMs,
  sink,
  actionNames,
  enabled = true,
}: AiPlayerPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<AiPlayerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [model, setModel] = useState<string>("");
  const [log, setLog] = useState<AiPlayerLogEntry[]>([]);
  const [loopState, setLoopState] = useState<AiPlayerLoopState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The status call is cheap and cached by the browser, but it still needs the
  // session cookie: it runs only when the panel is first opened.
  useEffect(() => {
    if (!open || status || statusError) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/ai/status", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as AiPlayerStatus & { suggestedModels?: string[] };
        if (cancelled) return;
        setStatus(body);
        setModel(body.model);
      } catch (error) {
        if (cancelled) return;
        setStatusError(error instanceof Error ? error.message : "unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, status, statusError]);

  /**
   * Localised text for the codes the loop emits.
   *
   * The loop's own messages stay Japanese as a fallback (they carry detail such
   * as which action was unknown), but anything with a known code is shown in
   * the visitor's language.
   */
  const translateLog = useCallback((entry: AiPlayerLogEntry): string => {
    const code = entry.code as AiPlayerLogCode | undefined;
    if (code) {
      const key = `aiPlayer.log.${code}`;
      const translated = t(key);
      // `t` returns the key itself when the locale has no entry.
      if (translated && translated !== key) return translated;
    }
    return entry.message;
  }, [t]);

  const appendLog = useCallback((entry: AiPlayerLogEntry) => {
    setLog((current) => [...current.slice(-(DEFAULT_LOG_LIMIT - 1)), entry]);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  // Leaving the stream must not leave a loop running against a dead channel:
  // every round would fail against a disposed client while still being billed
  // to the provider, so the loop stops as soon as streaming stops.
  useEffect(() => {
    if (enabled) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, [enabled]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    if (!sink) return;
    stop();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setLog([]);
    void runAiPlayerLoop({
      sink,
      buildObservation: ({ rounds, lastPlan }) => ({
        game: gameTitle,
        // Read at observation time, not at render time: a React re-render is
        // not guaranteed between rounds, and a stale clock would tell the model
        // the wrong amount of time has passed.
        elapsedSeconds: sessionStartedAtMs ? Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000)) : 0,
        plan: lastPlan || undefined,
        signals: rounds > 0 ? [`round ${rounds + 1}`] : undefined,
        availableActions: actionNames,
      }),
      options: {
        signal: controller.signal,
        onRound: (decision: AiPlayerDecision | null, entry) => {
          appendLog(entry);
          if (decision && decision.plan) {
            // The plan is already in the log line; nothing else to do here.
          }
        },
      },
      onState: setLoopState,
    }).catch((error: unknown) => {
      appendLog({
        atMs: Date.now(),
        level: "error",
        message: error instanceof Error ? error.message : "AI プレイヤーが停止しました。",
      });
    }).finally(() => {
      setRunning(false);
      abortRef.current = null;
    });
  }, [actionNames, appendLog, gameTitle, sessionStartedAtMs, sink, stop]);

  if (!enabled) return <></>;

  const configured = status?.configured === true;
  const unavailableReason = statusError
    ? t("aiPlayer.statusUnavailable")
    : status && !configured
      ? t("aiPlayer.missingKey")
      : null;

  return (
    <div className={`ai-player${open ? " ai-player--open" : ""}`} data-testid="ai-player-panel">
      <button
        type="button"
        className={`ai-player-toggle${running ? " ai-player-toggle--running" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={t("aiPlayer.title")}
      >
        <span className="ai-player-dot" aria-hidden="true" />
        {t("aiPlayer.shortLabel")}
      </button>

      {open && (
        <section className="ai-player-body" aria-label={t("aiPlayer.title")}>
          <header className="ai-player-head">
            <strong>{t("aiPlayer.title")}</strong>
            <button type="button" className="ai-player-close" onClick={() => setOpen(false)} aria-label={t("common.close")}>
              ×
            </button>
          </header>

          {unavailableReason && <p className="ai-player-note ai-player-note--warn">{unavailableReason}</p>}
          {status && configured && (
            <p className="ai-player-note">
              {t("aiPlayer.modelLabel")}: <code>{model || status.model}</code>
            </p>
          )}

          <div className="ai-player-controls">
            <button
              type="button"
              className="ai-player-start"
              onClick={running ? stop : start}
              disabled={!configured || !sink}
            >
              {running ? t("aiPlayer.stop") : t("aiPlayer.start")}
            </button>
            {loopState && running && (
              <span className="ai-player-round">{t("aiPlayer.round", { count: loopState.rounds })}</span>
            )}
          </div>

          {status && configured && AI_PLAYER_SUGGESTED_MODELS.length > 0 && (
            <label className="ai-player-model">
              <span>{t("aiPlayer.modelLabel")}</span>
              <select value={model} onChange={(event) => setModel(event.target.value)} disabled={running}>
                {Array.from(new Set([status.model, ...AI_PLAYER_SUGGESTED_MODELS])).map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
          )}

          {loopState?.lastError && (
            <div className="ai-player-note ai-player-note--warn">
              <p>{translateLog({ atMs: 0, level: "warn", message: loopState.lastError, code: loopState.lastErrorCode })}</p>
              {loopState.lastErrorCode === "session_expired" && (
                // Retrying cannot fix a stale session; the visitor needs a fresh
                // document, so offer the one action that works.
                <button
                  type="button"
                  className="ai-player-reload"
                  onClick={() => window.location.reload()}
                >
                  {t("aiPlayer.reload")}
                </button>
              )}
            </div>
          )}

          {log.length > 0 && (
            <ol className="ai-player-log" aria-live="polite">
              {log.slice(-8).map((entry, index) => (
                <li key={`${entry.atMs}-${index}`} className={`ai-player-log-${entry.level}`}>
                  {translateLog(entry)}
                </li>
              ))}
            </ol>
          )}

          <p className="ai-player-foot">{t("aiPlayer.disclaimer")}</p>
        </section>
      )}
    </div>
  );
});
