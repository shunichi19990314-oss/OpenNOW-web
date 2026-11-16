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
}

export interface AiPlayerLoopOptions {
  fetchImpl?: typeof fetch;
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
}

const DEFAULT_INTERVAL_MS = 1_500;
/** Extra wait after a failed round, so a broken provider is not hammered. */
const ERROR_BACKOFF_MS = 5_000;
const RELEASE_SETTLE_MS = 60;

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
  fetchImpl?: typeof fetch;
  model?: string;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onLog?: (entry: AiPlayerLogEntry) => void;
}): Promise<AiPlayerDecision | null> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const sleep = params.sleep ?? defaultSleep;
  const now = params.now ?? Date.now;
  const log = (level: AiPlayerLogEntry["level"], message: string): void => {
    params.onLog?.({ atMs: now(), level, message });
  };

  let response: Response;
  try {
    response = await fetchImpl(AI_PLAYER_DECIDE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        observation: params.observation,
        model: params.model,
      }),
      signal: params.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return null;
    log("error", "AI サーバーに接続できませんでした。");
    return null;
  }

  if (!response.ok) {
    // The proxy always answers with { error, message } for its own failures.
    let message = `AI リクエストが失敗しました (HTTP ${response.status})。`;
    try {
      const body = await response.json() as { message?: string; error?: string };
      if (body?.message) message = body.message;
      if (body?.error === "missing_key") {
        message = "サーバーに NUMES_API_KEY が設定されていません。";
      } else if (body?.error === "rate_limited" && typeof response.headers.get("retry-after") === "string") {
        message = `レート制限中です。${response.headers.get("retry-after")} 秒後に再試行します。`;
      }
    } catch {
      // Keep the status-based message.
    }
    log("warn", message);
    return null;
  }

  let payload: AiPlayerDecideResponse;
  try {
    payload = await response.json() as AiPlayerDecideResponse;
  } catch {
    log("error", "AI の応答が JSON ではありませんでした。");
    return null;
  }

  const { decision, problem } = parseAiPlayerDecision(payload?.raw ?? "", params.observation);
  if (!decision) {
    log("warn", `AI の応答を使用できません: ${problem ?? "unknown"}`);
    return null;
  }

  const sequence = buildActionSequence(decision.actions);
  if (decision.actions.length > 0 && sequence.length === 0) {
    log("warn", "AI が未知の操作を要求したため、入力は送信しませんでした。");
    return decision;
  }

  for (const step of sequence) {
    if (params.signal?.aborted) return decision;
    const delivered = params.sink.send(step.state);
    if (!delivered) {
      // The stream is not accepting input yet (handshake still in flight).
      // Releasing matters here too: leaving a button held would fire the action
      // whenever the channel opens.
      log("warn", "入力チャンネルが未接続のため、次のラウンドまで待機します。");
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
  const state: AiPlayerLoopState = { running: true, rounds: 0, lastPlan: "", lastError: null };
  params.onState?.({ ...state });

  while (!options.signal?.aborted) {
    const observation = params.buildObservation({ rounds: state.rounds, lastPlan: state.lastPlan });
    // Typed through a holder object: TypeScript narrows a `let` assigned only
    // inside a callback down to `null` and then rejects `.message`.
    const failure: { entry: AiPlayerLogEntry | null } = { entry: null };
    const decision = await runAiPlayerRound({
      observation,
      sink: params.sink,
      fetchImpl: options.fetchImpl,
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
      options.onRound?.(decision, { atMs: (options.now ?? Date.now)(), level: "info", message: "round complete" });
    } else {
      state.lastError = failure.entry?.message ?? "AI から応答がありませんでした。";
    }
    params.onState?.({ ...state });
    await sleep(decision ? intervalMs : ERROR_BACKOFF_MS);
  }

  state.running = false;
  // Release on the way out: the loop is the only writer of injected input.
  params.sink.send(buildNeutral());
  params.onState?.({ ...state });
}
