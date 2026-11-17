import { memo, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { useTranslation } from "../i18n";
import {
  AI_PLAYER_SLOW_MODELS,
  AI_PLAYER_SUGGESTED_MODELS,
  AI_PLAYER_VISION_FALLBACK_MODEL,
  modelSupportsVision,
  type AiChatTurn,
  type AiPlayerFrame,
  type AiPlayerMode,
  type AiPlayerStatus,
} from "../../shared/aiPlayer";
import {
  runAiPlayerLoop,
  type AiPlayerInputSink,
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
  /** Grabs the current stream frame, or null when capture is unavailable. */
  captureFrame?: (() => AiPlayerFrame | null) | null;
  /** False while connecting or after the stream ended. */
  enabled?: boolean;
}

const DEFAULT_LOG_LIMIT = 60;
const MAX_CONVERSATION_TURNS = 12;

/**
 * AI player overlay: automatic mode and chat mode in one panel.
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
  captureFrame = null,
  enabled = true,
}: AiPlayerPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<AiPlayerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [model, setModel] = useState<string>("");
  const [mode, setMode] = useState<AiPlayerMode>("auto");
  const [sendFrames, setSendFrames] = useState(true);
  const [log, setLog] = useState<AiPlayerLogEntry[]>([]);
  const [loopState, setLoopState] = useState<AiPlayerLoopState | null>(null);
  const [draft, setDraft] = useState("");
  const [conversation, setConversation] = useState<AiChatTurn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLOListElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);

  // The status call is cheap and cached by the browser, but it still needs the
  // session cookie: it runs only when the panel is first opened.
  useEffect(() => {
    if (!open || status || statusError) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/ai/status", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as AiPlayerStatus;
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

  const appendLog = useCallback((entry: AiPlayerLogEntry) => {
    setLog((current) => [...current.slice(-(DEFAULT_LOG_LIMIT - 1)), entry]);
  }, []);

  // Newest line visible without scrolling: the log is the main feedback surface,
  // so it should follow the tail like a terminal.
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (!conversationRef.current) return;
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [conversation]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setChatBusy(false);
  }, []);

  // Leaving the stream must not leave a loop running against a dead channel:
  // every round would fail against a disposed client while still being billed
  // to the provider, so the loop stops as soon as streaming stops.
  useEffect(() => {
    if (enabled) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setChatBusy(false);
  }, [enabled]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const slowModelNote = AI_PLAYER_SLOW_MODELS[model];
  const canCapture = typeof captureFrame === "function";
  // The panel lets the visitor pick a model, so vision follows the selection,
  // not only the configured default.
  const visionAvailable = canCapture && modelSupportsVision(model || status?.model || "");

  /**
   * Model changes the visitor makes have to keep the frame toggle honest.
   *
   * Choosing a text-only model while "send the screen" is on would otherwise
   * leave the checkbox ticked and the frames silently dropped; choosing an
   * image model while the screen is off would leave the AI blind for no reason
   * the visitor asked for.
   */
  const selectModel = useCallback((next: string) => {
    setModel(next);
    setSendFrames(modelSupportsVision(next));
  }, []);

  const buildObservation = useCallback((state: {
    rounds: number;
    lastPlan: string;
    lastActions: string[];
    repeatCount: number;
    frame: AiPlayerFrame | null;
  }) => ({
    game: gameTitle,
    // Read at observation time, not at render time: a React re-render is not
    // guaranteed between rounds, and a stale clock would tell the model the
    // wrong amount of time has passed.
    elapsedSeconds: sessionStartedAtMs
      ? Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000))
      : 0,
    plan: state.lastPlan || undefined,
    lastActions: state.lastActions.length > 0 ? state.lastActions : undefined,
    repeatCount: state.repeatCount,
    signals: state.rounds > 0 ? [`ラウンド ${state.rounds + 1}`] : undefined,
    availableActions: actionNames,
    frame: state.frame ?? undefined,
  }), [actionNames, gameTitle, sessionStartedAtMs]);

  /**
   * Chat mode: send one instruction, let the AI answer and act on it.
   *
   * Runs the loop for exactly one round (`runs: 1` equivalent) by aborting after
   * the first completed round, which reuses the whole press/release path rather
   * than duplicating it here.
   */
  const sendChat = useCallback(() => {
    const message = draft.trim();
    if (!message || !sink) return;
    setDraft("");
    setChatBusy(true);
    const turn: AiChatTurn = { role: "user", text: message };
    const history = [...conversation, turn].slice(-MAX_CONVERSATION_TURNS);
    setConversation(history);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void runAiPlayerLoop({
      sink,
      buildObservation,
      options: {
        signal: controller.signal,
        mode: "chat",
        // One instruction, one answer: the visitor then writes the next message.
        maxRounds: 1,
        instruction: message,
        conversation: history.filter((entry) => entry.text !== message),
        captureFrame: sendFrames && visionAvailable ? captureFrame : undefined,
        onRound: (decision, entry) => {
          // The loop reports each line; the decision carries the reply, which
          // is what the visitor is waiting for.
          appendLog(entry);
          if (decision?.reply) {
            const reply: AiChatTurn = { role: "assistant", text: decision.reply };
            setConversation((current) => [...current, reply].slice(-MAX_CONVERSATION_TURNS));
          }
        },
      },
      onState: setLoopState,
    }).catch(() => {
      // Errors already surface as log lines from the loop.
    }).finally(() => {
      setChatBusy(false);
      abortRef.current = null;
    });
  }, [appendLog, buildObservation, captureFrame, conversation, draft, sendFrames, sink, visionAvailable]);

  const startAuto = useCallback(() => {
    if (!sink) return;
    stop();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setLog([]);
    void runAiPlayerLoop({
      sink,
      buildObservation,
      options: {
        signal: controller.signal,
        mode: "auto",
        captureFrame: sendFrames && visionAvailable ? captureFrame : undefined,
        onRound: (_decision, entry) => appendLog(entry),
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
  }, [appendLog, buildObservation, captureFrame, sendFrames, sink, stop, visionAvailable]);

  const configured = status?.configured === true;
  const unavailableReason = statusError
    ? t("aiPlayer.statusUnavailable")
    : status && !configured
      ? t("aiPlayer.missingKey")
      : null;

  const stats = useMemo(() => {
    if (!loopState) return null;
    return {
      rounds: loopState.rounds,
      presses: loopState.sentPresses,
      frames: loopState.framesCaptured,
      dropped: loopState.framesDropped,
      breaks: loopState.varietyBreaks,
    };
  }, [loopState]);

  if (!enabled) return <></>;

  return (
    <div className={`ai-player${open ? " ai-player--open" : ""}`} data-testid="ai-player-panel">
      <button
        type="button"
        className={`ai-player-toggle${running || chatBusy ? " ai-player-toggle--running" : ""}`}
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
            <button type="button" className="ai-player-close" onClick={() => setOpen(false)} aria-label={t("aiPlayer.close")}>
              ×
            </button>
          </header>

          {unavailableReason && <p className="ai-player-note ai-player-note--warn">{unavailableReason}</p>}

          {/* Mode switch: the two things the visitor asked for. */}
          <div className="ai-player-modes" role="tablist" aria-label={t("aiPlayer.modeLabel")}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "auto"}
              className={`ai-player-mode${mode === "auto" ? " ai-player-mode--active" : ""}`}
              onClick={() => setMode("auto")}
              disabled={running || chatBusy}
            >
              {t("aiPlayer.modeAuto")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "chat"}
              className={`ai-player-mode${mode === "chat" ? " ai-player-mode--active" : ""}`}
              onClick={() => setMode("chat")}
              disabled={running || chatBusy}
            >
              {t("aiPlayer.modeChat")}
            </button>
          </div>

          <label className="ai-player-frame-toggle">
            <input
              type="checkbox"
              checked={sendFrames && visionAvailable && canCapture}
              onChange={(event) => setSendFrames(event.target.checked)}
              // Ticking the box is an explicit request to send the screen, so it
              // also switches to a model that can read it. Leaving it dead was
              // why "the AI looks at the screen" never worked with the default
              // text-only model.
              disabled={!canCapture || running || chatBusy}
            />
            <span>
              {t("aiPlayer.sendFrames")}
              {canCapture && status && !visionAvailable && (
                <em className="ai-player-frame-hint">
                  {" "}
                  {t("aiPlayer.visionUnavailableSwitch", { model: AI_PLAYER_VISION_FALLBACK_MODEL })}
                </em>
              )}
            </span>
          </label>

          {mode === "auto" ? (
            <div className="ai-player-controls">
              <button
                type="button"
                className="ai-player-start"
                onClick={running ? stop : startAuto}
                disabled={!configured || !sink}
              >
                {running ? t("aiPlayer.stop") : t("aiPlayer.start")}
              </button>
            </div>
          ) : (
            <div className="ai-player-chat">
              <div className="ai-player-conversation" ref={conversationRef} aria-live="polite">
                {conversation.length === 0 && (
                  <p className="ai-player-note ai-player-note--muted">{t("aiPlayer.chatEmpty")}</p>
                )}
                {conversation.map((turn, index) => (
                  <p
                    key={`${index}-${turn.role}`}
                    className={`ai-player-turn ai-player-turn--${turn.role}`}
                  >
                    <span className="ai-player-turn-role">
                      {turn.role === "user" ? t("aiPlayer.chatYou") : t("aiPlayer.chatAi")}
                    </span>
                    {turn.text}
                  </p>
                ))}
                {chatBusy && <p className="ai-player-note ai-player-note--muted">{t("aiPlayer.chatThinking")}</p>}
              </div>
              <form
                className="ai-player-chat-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendChat();
                }}
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t("aiPlayer.chatPlaceholder")}
                  disabled={!configured || !sink || chatBusy}
                  maxLength={400}
                />
                <button type="submit" disabled={!configured || !sink || chatBusy || draft.trim().length === 0}>
                  {t("aiPlayer.chatSend")}
                </button>
              </form>
            </div>
          )}

          {/* Stats row: makes "is it actually doing anything" answerable at a glance. */}
          {stats && (running || chatBusy || stats.rounds > 0) && (
            <dl className="ai-player-stats">
              <div><dt>{t("aiPlayer.statRounds")}</dt><dd>{stats.rounds}</dd></div>
              <div><dt>{t("aiPlayer.statPresses")}</dt><dd>{stats.presses}</dd></div>
              <div title={t("aiPlayer.statFramesHint")}>
                <dt>{t("aiPlayer.statFrames")}</dt><dd>{stats.frames}</dd>
              </div>
              {/* Only when it actually happened: a permanent "0 rejected" tile
                  would be noise, but a silent drop looks like a blind AI. */}
              {stats.dropped > 0 && (
                <div><dt>{t("aiPlayer.statDropped")}</dt><dd>{stats.dropped}</dd></div>
              )}
              <div><dt>{t("aiPlayer.statBreaks")}</dt><dd>{stats.breaks}</dd></div>
            </dl>
          )}

          {status && configured && (
            <label className="ai-player-model">
              <span>{t("aiPlayer.modelLabel")}</span>
              <select value={model} onChange={(event) => selectModel(event.target.value)} disabled={running || chatBusy}>
                {Array.from(new Set([status.model, ...AI_PLAYER_SUGGESTED_MODELS])).map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
              {/* Why the previous session sat on "時間切れ": the model itself is
                  a thinking model whose measured first token takes seconds. */}
              {slowModelNote && (
                <em className="ai-player-model-hint" title={slowModelNote}>
                  {t("aiPlayer.modelSlowWarning")}
                </em>
              )}
            </label>
          )}

          {loopState?.lastError && (
            <div className="ai-player-note ai-player-note--warn" role="status">
              {/* The same failure is already a log row directly below; printing
                  it twice made the panel look like two separate problems. */}
              <p>{t("aiPlayer.lastError")}</p>
              {loopState.lastErrorCode === "session_expired" && (
                // Retrying cannot fix a stale session; the visitor needs a fresh
                // document, so offer the one action that works.
                <button type="button" className="ai-player-reload" onClick={() => window.location.reload()}>
                  {t("aiPlayer.reload")}
                </button>
              )}
            </div>
          )}

          {log.length > 0 && (
            <div className="ai-player-log-wrap">
              <div className="ai-player-log-head">
                <span>{t("aiPlayer.logTitle")}</span>
                <button type="button" className="ai-player-log-clear" onClick={() => setLog([])}>
                  {t("aiPlayer.logClear")}
                </button>
              </div>
              <ol className="ai-player-log" ref={logRef} aria-live="polite">
                {log.map((entry, index) => (
                  <li
                    key={`${entry.atMs}-${index}`}
                    className={`ai-player-log-row ai-player-log-${entry.level}`}
                    data-code={entry.code}
                  >
                    <span className="ai-player-log-icon" aria-hidden="true">
                      {entry.level === "error" ? "✕" : entry.level === "warn" ? "!" : entry.code === "forced_variety" ? "↻" : "·"}
                    </span>
                    <span className="ai-player-log-text">{entry.message}</span>
                    {entry.actions && entry.actions.length > 0 && (
                      <span className="ai-player-log-actions">
                        {entry.actions.map((action) => (
                          <span key={action} className="ai-player-chip">{t(`aiPlayer.actions.${action}`) === `aiPlayer.actions.${action}` ? action : t(`aiPlayer.actions.${action}`)}</span>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="ai-player-foot">{t("aiPlayer.disclaimer")}</p>
        </section>
      )}
    </div>
  );
});
