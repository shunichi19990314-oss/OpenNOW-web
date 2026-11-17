/**
 * Browser-side automation loop for the AI player.
 *
 * Split from React on purpose: the loop needs precise timing, an abort path and
 * a fake clock in tests, none of which survive inside a component. The sink and
 * the frame capture are injected, so nothing here touches WebRTC or the DOM.
 *
 * Two modes share one transport:
 *
 *   auto — observe, decide, press, wait, repeat
 *   chat — the visitor's message is the instruction; the AI answers and acts
 *
 * Everything the visitor reads is Japanese (the panel is Japanese-only for now);
 * codes are still attached so the UI can localise later without touching logic.
 */
import {
  AI_PLAYER_CHAT_PATH,
  AI_PLAYER_DECIDE_PATH,
  AI_PLAYER_AUTO_INTERVAL_MS,
  type AiChatTurn,
  type AiPlayerDecideResponse,
  type AiPlayerDecision,
  type AiPlayerFrame,
  type AiPlayerMode,
  type AiPlayerObservation,
} from "../../shared/aiPlayer";
import { api } from "../api";
import { buildActionSequence, type InjectedGamepadState } from "./aiPlayerActions";
import { parseAiPlayerDecision } from "../../shared/aiPlayerPrompt";
import {
  enforceVariety,
  INITIAL_REPEAT_TRACKER,
  type RepeatTracker,
} from "./aiPlayerVariety";

/** How a decision becomes input. */
export interface AiPlayerInputSink {
  /** Returns false when the stream is not accepting input yet. */
  send(state: InjectedGamepadState): boolean;
  /**
   * Optional heartbeat.
   *
   * A game treats a silent controller as disconnected and ignores later input,
   * so the sink can be asked to repeat the last frame while the loop waits
   * between rounds.
   */
  keepAlive?: () => void;
}

export interface AiPlayerLogEntry {
  atMs: number;
  level: "info" | "warn" | "error";
  message: string;
  /**
   * Machine-readable code for messages the UI can translate.
   *
   * `message` is already Japanese; the code exists so the panel can attach an
   * icon or replace the wording per locale without parsing strings.
   */
  code?: AiPlayerLogCode;
  /** Set when this entry records a button press that reached the wire. */
  sentPress?: boolean;
  /** Actions this entry describes, for the log's structured rendering. */
  actions?: string[];
}

export type AiPlayerLogCode =
  | "session_expired"
  | "rate_limited"
  | "not_configured"
  | "network"
  | "bad_reply"
  | "unknown_action"
  | "input_not_ready"
  | "frame_captured"
  | "forced_variety"
  | "frame_rejected";

export interface AiPlayerLoopOptions {
  mode?: AiPlayerMode;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between decision rounds. */
  intervalMs?: number;
  /** Called for every log line. */
  onRound?: (decision: AiPlayerDecision | null, log: AiPlayerLogEntry) => void;
  signal?: AbortSignal;
  /** Overrides the proxy call (tests only). */
  post?: AiPlayerPost;
  /** Grabs the current frame, or null when vision is off / unavailable. */
  captureFrame?: () => AiPlayerFrame | null;
  /** Chat mode: the instruction to act on, then cleared. */
  instruction?: string;
  /** Chat mode: conversation so far, oldest first. */
  conversation?: AiChatTurn[];
  model?: string;
  /**
   * Stop after this many rounds.
   *
   * Chat mode uses `1`: the visitor asked for one instruction, so answering once
   * and waiting for the next message is the whole job. Auto mode leaves it unset
   * and runs until aborted.
   */
  maxRounds?: number;
}

export interface AiPlayerLoopState {
  running: boolean;
  rounds: number;
  lastPlan: string;
  lastError: string | null;
  /** Code for `lastError`, so the UI can localise it. */
  lastErrorCode?: AiPlayerLogCode;
  /**
   * Button presses delivered to the stream so far.
   *
   * Shown in the panel because "the AI is thinking but nothing happens" was
   * indistinguishable from "the AI is sending input the game ignores" without
   * it — the session that prompted this ran 51 rounds and reported nothing.
   */
  sentPresses: number;
  /**
   * Frames captured so far.
   *
   * Named for what it counts: the capture happens per round whether or not the
   * provider accepts it, and the panel pairs it with `framesDropped` so a "0
   * frames delivered" session is distinguishable from "capture never ran".
   */
  framesCaptured: number;
  /** Rounds where the provider refused the image and text-only was used. */
  framesDropped: number;
  /** Rounds where the fallback rotation replaced the model's choice. */
  varietyBreaks: number;
  /** Last reply addressed to the visitor (chat mode). */
  lastReply: string | null;
}

const EMPTY_STATE: AiPlayerLoopState = {
  running: true,
  rounds: 0,
  lastPlan: "",
  lastError: null,
  lastErrorCode: undefined,
  sentPresses: 0,
  framesCaptured: 0,
  framesDropped: 0,
  varietyBreaks: 0,
  lastReply: null,
};

const DEFAULT_INTERVAL_MS = AI_PLAYER_AUTO_INTERVAL_MS;
/** Extra wait after a failed round, so a broken provider is not hammered. */
const ERROR_BACKOFF_MS = 5_000;
const RELEASE_SETTLE_MS = 60;
/** Interval for the controller heartbeat, matching the physical pad path. */
const KEEPALIVE_MS = 100;

/** Posts a body to this app's own proxy. Injectable for tests. */
export type AiPlayerPost<TBody = unknown> = (
  path: string,
  body: TBody,
  signal?: AbortSignal,
) => Promise<AiPlayerDecideResponse>;

const defaultPost: AiPlayerPost = async (path, body, signal) => {
  // `api()` attaches the CSRF marker and throws with `httpStatus` set, which
  // `runAiPlayerRound` reads to explain the failure.
  return api<AiPlayerDecideResponse>(path, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Turns a failed decision call into something the visitor can act on.
 *
 * The server's own text is kept when it explains the cause, but session
 * problems get explicit guidance: they are the one case where retrying the
 * button never helps, and the AI panel can still look "ready" while the tab's
 * cookie is stale (for example a stream opened in a window separate from the
 * settings page).
 */
export function describeDecisionFailure(status: number, serverMessage: string): string {
  if (status === 403 || status === 401) {
    return "このタブのログイン情報が無効になっています (HTTP "
      + status
      + ")。ページを再読み込みし、ログインし直してからお試しください。";
  }
  if (status === 429) {
    return serverMessage || "リクエストが集中しています。しばらく待って再試行します。";
  }
  if (serverMessage) return serverMessage;
  return `AI リクエストが失敗しました (HTTP ${status})。`;
}

/** Request body shared by both modes. */
interface RoundRequestBody {
  observation: AiPlayerObservation;
  model?: string;
  mode?: AiPlayerMode;
  /** Chat mode adds these. */
  message?: string;
  conversation?: AiChatTurn[];
  includeFrame?: boolean;
}

/**
 * One round: observe, decide, inject.
 *
 * Exported so it can be tested without timers or a stream.
 */
export async function runAiPlayerRound(params: {
  observation: AiPlayerObservation;
  sink: AiPlayerInputSink;
  mode?: AiPlayerMode;
  model?: string;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onLog?: (entry: AiPlayerLogEntry) => void;
  /** Overrides the proxy call (tests only). */
  post?: AiPlayerPost<RoundRequestBody>;
  /** Chat message; switches the request to `/api/ai/chat`. */
  message?: string;
  conversation?: AiChatTurn[];
  /** Called when the proxy had to drop the screenshot to get an answer. */
  onFrameDropped?: () => void;
}): Promise<AiPlayerDecision | null> {
  const sleep = params.sleep ?? defaultSleep;
  const now = params.now ?? Date.now;
  const post = params.post ?? defaultPost;
  const log = (
    level: AiPlayerLogEntry["level"],
    message: string,
    code?: AiPlayerLogCode,
    extra?: Partial<AiPlayerLogEntry>,
  ): void => {
    params.onLog?.({ atMs: now(), level, message, code, ...extra });
  };

  // Chat routing is per instruction, not per mode: without a message there is
  // nothing to route to /api/ai/chat, so the round falls back to /decide.
  const isChat = typeof params.message === "string" && params.message.trim().length > 0;
  const body: RoundRequestBody = isChat
    ? {
      observation: params.observation,
      model: params.model,
      mode: "chat",
      message: params.message,
      conversation: params.conversation,
      includeFrame: true,
    }
    : { observation: params.observation, model: params.model, mode: "auto" };

  let payload: AiPlayerDecideResponse;
  try {
    payload = await post(isChat ? AI_PLAYER_CHAT_PATH : AI_PLAYER_DECIDE_PATH, body, params.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return null;
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status === undefined) {
      log("error", "AI サーバーに接続できませんでした。通信環境を確認してください。", "network");
      return null;
    }
    const message = describeDecisionFailure(status, error instanceof Error ? error.message : "");
    log("warn", message, status === 401 || status === 403
      ? "session_expired"
      : status === 429
        ? "rate_limited"
        : (error as { errorCode?: string }).errorCode === "missing_key"
          ? "not_configured"
          : undefined);
    return null;
  }

  // The proxy retried without the picture because the provider refused it.
  // Saying so is the difference between "the AI is blind" and "the AI was told
  // the screenshot was dropped" for whoever reads the log.
  if (payload?.droppedFrame) {
    params.onFrameDropped?.();
    log(
      "warn",
      "画面画像が AI プロバイダに拒否されたため、このラウンドは文字情報だけで判断しました。モデルを画像対応のものに変えると画面が使えます。",
      "frame_rejected",
    );
  }

  const { decision, problem } = parseAiPlayerDecision(payload?.raw ?? "", params.observation);
  if (!decision) {
    log("warn", `AI の応答を使用できません: ${problem ?? "不明な形式"}`, "bad_reply");
    return null;
  }

  // Chat mode may legitimately answer without pressing anything.
  if (decision.actions.length > 0) {
    const sequence = buildActionSequence(decision.actions);
    if (sequence.length === 0) {
      log("warn", "AI が未知の操作を要求したため、入力は送信しませんでした。", "unknown_action");
      return decision;
    }
    for (const step of sequence) {
      if (params.signal?.aborted) return decision;
      const delivered = params.sink.send(step.state);
      if (delivered && step.state.buttons !== 0) {
        // One line per distinct button press, so a session where the game
        // ignores input can be told apart from one where nothing was sent.
        log(
          "info",
          `ボタンを送信: 0x${step.state.buttons.toString(16)} (${step.durationMs}ms)`,
          undefined,
          { sentPress: true },
        );
      }
      if (!delivered) {
        // The stream is not accepting input yet (handshake still in flight).
        // Releasing matters here too: leaving a button held would fire the
        // action whenever the channel opens.
        log("warn", "入力チャンネルが未接続のため、次のラウンドまで待機します。", "input_not_ready");
        break;
      }
      await sleep(step.durationMs);
    }
    // Always return to neutral, even on abort, so no input stays pressed.
    params.sink.send(buildNeutral());
    await sleep(RELEASE_SETTLE_MS);
  }

  const actionNames = decision.actions.map((action) => action.action);
  log(
    "info",
    decision.reply
      ? decision.reply
      : decision.plan
        ? `計画: ${decision.plan}`
        : actionNames.length > 0
          ? `操作: ${actionNames.join(", ")}`
          : "待機しています",
    undefined,
    actionNames.length > 0 ? { actions: actionNames } : undefined,
  );
  return decision;
}

/** Waits `totalMs`, ticking the sink's keepalive on the way. */
async function waitWithKeepAlive(
  totalMs: number,
  sink: AiPlayerInputSink,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!sink.keepAlive) {
    await sleep(totalMs);
    return;
  }
  let remaining = totalMs;
  while (remaining > 0 && !signal?.aborted) {
    const slice = Math.min(KEEPALIVE_MS, remaining);
    await sleep(slice);
    remaining -= slice;
    try {
      sink.keepAlive();
    } catch {
      // A heartbeat must never break the loop.
    }
  }
}

function buildNeutral(): InjectedGamepadState {
  return { buttons: 0, leftTrigger: 0, rightTrigger: 0, leftStickX: 0, leftStickY: 0, rightStickX: 0, rightStickY: 0 };
}

export interface AiPlayerLoopParams {
  sink: AiPlayerInputSink;
  /** Builds the observation for this round from the loop's own bookkeeping. */
  buildObservation: (state: {
    rounds: number;
    lastPlan: string;
    lastActions: string[];
    repeatCount: number;
    frame: AiPlayerFrame | null;
  }) => AiPlayerObservation;
  options?: AiPlayerLoopOptions;
  onState?: (state: AiPlayerLoopState) => void;
}

/**
 * Runs rounds until stopped.
 *
 * Auto mode keeps the last plan so a long session keeps the model's intent; the
 * frame is captured per round (a stale screenshot is worse than none — it makes
 * the model act on a situation that no longer exists).
 */
export async function runAiPlayerLoop(params: AiPlayerLoopParams): Promise<void> {
  const options = params.options ?? {};
  const sleep = options.sleep ?? defaultSleep;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const state: AiPlayerLoopState = { ...EMPTY_STATE };
  let tracker: RepeatTracker = INITIAL_REPEAT_TRACKER;
  let frame: AiPlayerFrame | null = null;
  let instruction = options.instruction;
  params.onState?.({ ...state });

  while (!options.signal?.aborted) {
    // Capture per round, not per session: the whole point is to react to what
    // the screen shows *now*.
    frame = options.captureFrame?.() ?? null;
    if (frame) {
      state.framesCaptured += 1;
      options.onRound?.(null, {
        atMs: (options.now ?? Date.now)(),
        level: "info",
        message: `画面を取得しました (${frame.width}×${frame.height})`,
        code: "frame_captured",
      });
    }

    const observation = params.buildObservation({
      rounds: state.rounds,
      lastPlan: state.lastPlan,
      lastActions: tracker.last,
      repeatCount: tracker.count,
      frame,
    });
    if (instruction) {
      observation.instruction = instruction;
    }
    if (options.conversation && options.conversation.length > 0) {
      observation.conversation = options.conversation;
    }

    const failure: { entry: AiPlayerLogEntry | null } = { entry: null };
    const decision = await runAiPlayerRound({
      observation,
      sink: params.sink,
      mode: options.mode ?? "auto",
      model: options.model,
      signal: options.signal,
      sleep,
      now: options.now,
      post: options.post,
      message: instruction,
      conversation: options.conversation,
      onFrameDropped: () => {
        state.framesDropped += 1;
      },
      onLog: (entry) => {
        if (entry.level !== "info") failure.entry = entry;
        if (entry.sentPress) state.sentPresses += 1;
        options.onRound?.(null, entry);
      },
    });
    // A chat instruction is consumed exactly once: repeating it every round
    // would turn one request into an endless command.
    instruction = undefined;
    if (options.signal?.aborted) break;

    state.rounds += 1;
    if (decision) {
      state.lastPlan = decision.plan || state.lastPlan;
      state.lastReply = decision.reply ?? state.lastReply;
      // The decision carries the reply the visitor is waiting for in chat mode;
      // without this callback the panel had nothing to show.
      options.onRound?.(decision, {
        atMs: (options.now ?? Date.now)(),
        level: "info",
        message: decision.reply ?? decision.plan ?? "ラウンド完了",
      });
      state.lastError = null;
      state.lastErrorCode = undefined;

      // Break repetition even when the model insists on the same action.
      const variety = enforceVariety(tracker, decision.actions, state.rounds, observation.availableActions);
      tracker = variety.tracker;
      if (variety.overridden) {
        state.varietyBreaks += 1;
        options.onRound?.(null, {
          atMs: (options.now ?? Date.now)(),
          level: "info",
          message: `同じ操作が続いたため「${variety.actions[0]?.action}」に切り替えました`,
          code: "forced_variety",
          actions: variety.actions.map((action) => action.action),
        });
        // The override has to be pressed here: the round already finished with
        // the model's own choice.
        for (const action of variety.actions) {
          if (options.signal?.aborted) break;
          params.sink.send(buildNeutral());
          const [pressed] = buildActionSequence([action]);
          if (pressed) {
            params.sink.send(pressed.state);
            await sleep(pressed.durationMs);
            params.sink.send(buildNeutral());
          }
        }
      }
    } else {
      state.lastError = failure.entry?.message ?? "AI から応答がありませんでした。";
      state.lastErrorCode = failure.entry?.code;
    }
    params.onState?.({ ...state });
    if (options.maxRounds !== undefined && state.rounds >= options.maxRounds) {
      break;
    }
    await waitWithKeepAlive(
      decision ? intervalMs : ERROR_BACKOFF_MS,
      params.sink,
      sleep,
      options.signal,
    );
  }

  state.running = false;
  // Release on the way out: the loop is the only writer of injected input.
  params.sink.send(buildNeutral());
  params.onState?.({ ...state });
}
