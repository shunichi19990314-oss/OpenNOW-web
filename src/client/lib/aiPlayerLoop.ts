/**
 * Browser-side automation loop for the AI player.
 *
 * Split from React on purpose: the loop needs precise timing, an abort path and
 * a fake clock in tests, none of which survive inside a component. The sink is
 * injected, so nothing here touches WebRTC directly.
 *
 * Flow per round:
 *   1. ask this app's server for a decision (the key stays server-side)
 *   2. validate the reply against the offered actions
 *   3. press each action with a hold and a release
 *   4. wait one interval, carrying the plan forward for continuity
 */
import {
  AI_PLAYER_DECIDE_PATH,
  type AiPlayerDecideResponse,
  type AiPlayerDecision,
  type AiPlayerObservation,
} from "../../shared/aiPlayer";
import { api } from "../api";
import { buildActionSequence, type InjectedGamepadState } from "./aiPlayerActions";
import { parseAiPlayerDecision } from "../../shared/aiPlayerPrompt";

/** How a decision becomes input. */
export interface AiPlayerInputSink {
  /** Returns false when the stream is not accepting input yet. */
  send(state: InjectedGamepadState): boolean;
}

export interface AiPlayerLogEntry {
  atMs: number;
  level: "info" | "warn" | "error";
  message: string;
  /**
   * Machine-readable code for messages the UI can translate.
   *
   * `message` stays Japanese and is the fallback; the panel prefers a localised
   * string when it recognises the code, so a visitor reading Korean is not shown
   * Japanese error text.
   */
  code?: AiPlayerLogCode;
}

export type AiPlayerLogCode =
  | "session_expired"
  | "rate_limited"
  | "not_configured"
  | "network"
  | "bad_reply"
  | "unknown_action"
  | "input_not_ready";

export interface AiPlayerLoopOptions {
  post?: AiPlayerPost;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between decision rounds. */
  intervalMs?: number;
  /** Called after every round so the UI can show what happened. */
  onRound?: (decision: AiPlayerDecision | null, log: AiPlayerLogEntry) => void;
  signal?: AbortSignal;
}

export interface AiPlayerLoopState {
  running: boolean;
  rounds: number;
  lastPlan: string;
  lastError: string | null;
  /** Code for `lastError`, so the UI can localise it. */
  lastErrorCode?: AiPlayerLogCode;
}

const DEFAULT_INTERVAL_MS = 1_500;
/** Extra wait after a failed round, so a broken provider is not hammered. */
const ERROR_BACKOFF_MS = 5_000;
const RELEASE_SETTLE_MS = 60;

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

/** Posts an observation to this app's own proxy. Injectable for tests. */
export type AiPlayerPost = (
  body: { observation: AiPlayerObservation; model?: string },
  signal?: AbortSignal,
) => Promise<AiPlayerDecideResponse>;

const defaultPost: AiPlayerPost = async (body, signal) => {
  // `api()` throws with `httpStatus` set, which `runAiPlayerRound` reads above.
  return api<AiPlayerDecideResponse>(AI_PLAYER_DECIDE_PATH, {
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
 * One round: observe, decide, inject.
 *
 * Exported so it can be tested without timers or a stream.
 */
export async function runAiPlayerRound(params: {
  observation: AiPlayerObservation;
  sink: AiPlayerInputSink;
  model?: string;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onLog?: (entry: AiPlayerLogEntry) => void;
  /** Overrides the proxy call (tests only). */
  post?: AiPlayerPost;
}): Promise<AiPlayerDecision | null> {
  const sleep = params.sleep ?? defaultSleep;
  const now = params.now ?? Date.now;
  const log = (level: AiPlayerLogEntry["level"], message: string, code?: AiPlayerLogCode): void => {
    params.onLog?.({ atMs: now(), level, message, code });
  };

  // Uses the shared `api()` helper rather than a bare fetch: it sends the
  // `X-OpenNOW-Client` marker and turns a non-2xx reply into an Error carrying
  // both the server's own message and the HTTP status. A bare fetch here meant
  // a 403 from the same-origin guard surfaced as "HTTP 403" with no cause.
  let payload: AiPlayerDecideResponse;
  try {
    payload = await (params.post ?? defaultPost)({
      observation: params.observation,
      model: params.model,
    }, params.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return null;
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status === undefined) {
      log("error", "AI サーバーに接続できませんでした。", "network");
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

  const { decision, problem } = parseAiPlayerDecision(payload?.raw ?? "", params.observation);
  if (!decision) {
    log("warn", `AI の応答を使用できません: ${problem ?? "unknown"}`, "bad_reply");
    return null;
  }

  const sequence = buildActionSequence(decision.actions);
  if (decision.actions.length > 0 && sequence.length === 0) {
    log("warn", "AI が未知の操作を要求したため、入力は送信しませんでした。", "unknown_action");
    return decision;
  }

  for (const step of sequence) {
    if (params.signal?.aborted) return decision;
    const delivered = params.sink.send(step.state);
    if (!delivered) {
      // The stream is not accepting input yet (handshake still in flight).
      // Releasing matters here too: leaving a button held would fire the action
      // whenever the channel opens.
      log("warn", "入力チャンネルが未接続のため、次のラウンドまで待機します。", "input_not_ready");
      break;
    }
    await sleep(step.durationMs);
  }
  // Always return to neutral, even on abort, so no input stays pressed.
  params.sink.send(buildNeutral());
  await sleep(RELEASE_SETTLE_MS);

  log("info", decision.plan ? `計画: ${decision.plan}` : `操作: ${decision.actions.map((a) => a.action).join(", ")}`);
  return decision;
}

function buildNeutral(): InjectedGamepadState {
  return { buttons: 0, leftTrigger: 0, rightTrigger: 0, leftStickX: 0, leftStickY: 0, rightStickX: 0, rightStickY: 0 };
}

/**
 * Runs rounds until stopped.
 *
 * Stops silently on abort, and keeps the last plan so a long session keeps the
 * model's intent across rounds instead of re-planning from scratch each time.
 */
export async function runAiPlayerLoop(params: {
  sink: AiPlayerInputSink;
  buildObservation: (state: { rounds: number; lastPlan: string }) => AiPlayerObservation;
  options?: AiPlayerLoopOptions;
  onState?: (state: AiPlayerLoopState) => void;
}): Promise<void> {
  const options = params.options ?? {};
  const sleep = options.sleep ?? defaultSleep;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const state: AiPlayerLoopState = { running: true, rounds: 0, lastPlan: "", lastError: null, lastErrorCode: undefined };
  params.onState?.({ ...state });

  while (!options.signal?.aborted) {
    const observation = params.buildObservation({ rounds: state.rounds, lastPlan: state.lastPlan });
    // Typed through a holder object: TypeScript narrows a `let` assigned only
    // inside a callback down to `null` and then rejects `.message`.
    const failure: { entry: AiPlayerLogEntry | null } = { entry: null };
    const decision = await runAiPlayerRound({
      observation,
      sink: params.sink,
      post: options.post,
      signal: options.signal,
      sleep,
      now: options.now,
      onLog: (entry) => {
        if (entry.level !== "info") failure.entry = entry;
        options.onRound?.(null, entry);
      },
    });
    if (options.signal?.aborted) break;
    state.rounds += 1;
    if (decision) {
      state.lastPlan = decision.plan || state.lastPlan;
      state.lastError = null;
      state.lastErrorCode = undefined;
      options.onRound?.(decision, { atMs: (options.now ?? Date.now)(), level: "info", message: "round complete" });
    } else {
      state.lastError = failure.entry?.message ?? "AI から応答がありませんでした。";
      state.lastErrorCode = failure.entry?.code;
    }
    params.onState?.({ ...state });
    await sleep(decision ? intervalMs : ERROR_BACKOFF_MS);
  }

  state.running = false;
  // Release on the way out: the loop is the only writer of injected input.
  params.sink.send(buildNeutral());
  params.onState?.({ ...state });
}
