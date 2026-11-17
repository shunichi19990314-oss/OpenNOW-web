/**
 * Server-side proxy for the AI player.
 *
 * The browser never sees the provider key: it posts a compact observation here,
 * and this module turns it into a chat request against an OpenAI-compatible
 * endpoint (Numes by default) and returns the model's text for the client-side
 * parser to validate.
 *
 * Configuration is environment-only, matching how the rest of the operator
 * settings work (`SESSION_SECRET`, `OPENNOW_ACCESS_PASSWORD`, ...):
 *
 *   NUMES_API_KEY   sk-...                       (required; server-side only)
 *   NUMES_BASE_URL  https://api.numes.ai/api/v1  (optional override)
 *   AI_PLAYER_MODEL z-ai/glm-5.3                 (optional override)
 *   AI_PLAYER_DAILY_REQUESTS  0                  (per-user/day cap, 0 = off)
 */
import {
  AI_PLAYER_CHAT_SYSTEM_PROMPT,
  AI_PLAYER_SYSTEM_PROMPT,
  buildObservationText,
  buildUserContent,
  type AiMessageContent,
} from "@shared/aiPlayerPrompt";
import {
  AI_PLAYER_DEFAULT_MODEL,
  AI_PLAYER_FRAME_MAX_BYTES,
  AI_PLAYER_VISION_MODELS,
  type AiChatMessage,
  type AiPlayerChatRequest,
  type AiPlayerDecideRequest,
  type AiPlayerDecideResponse,
  type AiPlayerErrorCode,
  type AiPlayerFrame,
  type AiPlayerMode,
  type AiPlayerObservation,
  type AiPlayerStatus,
} from "@shared/aiPlayer";

const DEFAULT_BASE_URL = "https://api.numes.ai/api/v1";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_OBSERVATION_FIELD = 2_000;
const MAX_ACTIONS_OFFERED = 40;
/** A data URL is base64, so the string is ~4/3 the image size. */
const MAX_FRAME_DATA_URL_LENGTH = Math.ceil(AI_PLAYER_FRAME_MAX_BYTES / 3) * 4;

/**
 * Models an operator may pin without exposing the key.
 *
 * The allowlist is not about cost — free models cost nothing — but about
 * blast radius: the model id is a user-supplied string in the request body, and
 * an unrestricted value would let any visitor route traffic (and the operator's
 * key) to arbitrary third-party hosts if the provider ever honours
 * `provider/base_url` routing.
 */
const ALLOWED_MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface AiPlayerConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dailyRequestCap: number;
}

/**
 * Reads configuration from the environment.
 *
 * Called per request rather than cached at import time so a deploy-time env
 * change does not require a code change, and so tests can inject a value.
 */
export function resolveAiPlayerConfig(env: NodeJS.ProcessEnv = process.env): AiPlayerConfig {
  const rawBaseUrl = readEnvFrom(env, "NUMES_BASE_URL") || DEFAULT_BASE_URL;
  // Strip a trailing slash: "https://x/api/v1/" + "/chat/completions" would
  // otherwise produce a double slash that some gateways 404.
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const model = readEnvFrom(env, "AI_PLAYER_MODEL") || AI_PLAYER_DEFAULT_MODEL;
  const cap = Number.parseInt(readEnvFrom(env, "AI_PLAYER_DAILY_REQUESTS"), 10);
  return {
    apiKey: readEnvFrom(env, "NUMES_API_KEY"),
    baseUrl,
    model,
    dailyRequestCap: Number.isFinite(cap) && cap > 0 ? cap : 0,
  };
}

function readEnvFrom(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Whether the configured model can accept images.
 *
 * Used by the UI to warn before spending tokens on frames that would be
 * rejected, and to decide whether "画面を送る" is even meaningful.
 */
export function modelSupportsVision(model: string): boolean {
  return (AI_PLAYER_VISION_MODELS as readonly string[]).includes(model);
}

/** Status shown in the settings panel. Never includes the key. */
export function describeAiPlayerStatus(config: AiPlayerConfig = resolveAiPlayerConfig()): AiPlayerStatus {
  return {
    configured: config.apiKey.length > 0,
    model: config.model,
    baseUrl: config.baseUrl,
    reason: config.apiKey.length > 0 ? undefined : "missing_key",
    vision: modelSupportsVision(config.model),
  };
}

export class AiPlayerError extends Error {
  public readonly code: AiPlayerErrorCode;
  public readonly statusCode: number;
  public readonly retryAfterSeconds?: number;

  constructor(code: AiPlayerErrorCode, message: string, statusCode: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "AiPlayerError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  toBody(): { error: AiPlayerErrorCode; message: string; retryAfterSeconds?: number } {
    return {
      error: this.code,
      message: this.message,
      ...(this.retryAfterSeconds !== undefined ? { retryAfterSeconds: this.retryAfterSeconds } : {}),
    };
  }
}

function sanitizeField(value: unknown, maxLength = MAX_OBSERVATION_FIELD): string {
  if (typeof value !== "string") return "";
  // Control characters would break the prompt structure and waste tokens.
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength).trim();
}

/**
 * Validates the observation before it reaches the provider.
 *
 * Every field is bounded: the request body is attacker-controlled, and an
 * unbounded `signals` array or a 10 MB `plan` would be billed to the operator.
 */
export function sanitizeObservation(raw: unknown): AiPlayerObservation {
  if (!raw || typeof raw !== "object") {
    throw new AiPlayerError("invalid_response", "観測データの形式が不正です。", 400);
  }
  const record = raw as Record<string, unknown>;
  const availableActions = Array.isArray(record.availableActions)
    ? record.availableActions
      .map((value) => sanitizeField(value, 32).toLowerCase())
      .filter((value) => value.length > 0)
      .slice(0, MAX_ACTIONS_OFFERED)
    : [];
  const elapsed = Number(record.elapsedSeconds);
  const signals = Array.isArray(record.signals)
    ? record.signals.map((value) => sanitizeField(value, 120)).filter(Boolean).slice(0, 6)
    : undefined;
  const conversation = Array.isArray(record.conversation)
    ? record.conversation
      .slice(-10)
      .map((turn) => {
        if (!turn || typeof turn !== "object") return null;
        const entry = turn as Record<string, unknown>;
        const role = entry.role === "assistant" ? "assistant" as const : "user" as const;
        const text = sanitizeField(entry.text, 600);
        return text ? { role, text } : null;
      })
      .filter((turn): turn is { role: "user" | "assistant"; text: string } => turn !== null)
    : undefined;

  return {
    game: sanitizeField(record.game, 120) || "unknown game",
    elapsedSeconds: Number.isFinite(elapsed) ? Math.max(0, Math.min(86_400, Math.round(elapsed))) : 0,
    plan: sanitizeField(record.plan, 400) || undefined,
    signals,
    availableActions,
    frame: sanitizeFrame(record.frame),
    instruction: sanitizeField(record.instruction, 600) || undefined,
    conversation,
    lastActions: Array.isArray(record.lastActions)
      ? record.lastActions.map((value) => sanitizeField(value, 32).toLowerCase()).filter(Boolean).slice(0, 8)
      : undefined,
    repeatCount: Number.isFinite(Number(record.repeatCount))
      ? Math.max(0, Math.min(100, Math.round(Number(record.repeatCount))))
      : undefined,
  };
}

/**
 * Validates a captured frame.
 *
 * Only a JPEG data URL is accepted: the value is forwarded verbatim to the
 * provider inside a JSON body, so an arbitrary URL (or an SVG data URL, which
 * can carry script) must not pass. Oversized payloads are refused rather than
 * silently truncated — a half image would be billed and be useless.
 */
export function sanitizeFrame(raw: unknown): AiPlayerFrame | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
  if (!dataUrl.startsWith("data:image/jpeg;base64,")) return undefined;
  if (dataUrl.length > MAX_FRAME_DATA_URL_LENGTH) {
    throw new AiPlayerError("frame_too_large", "取得した画面が大きすぎるため送信できません。", 413);
  }
  const width = Number(record.width);
  const height = Number(record.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { dataUrl, width: Math.round(width), height: Math.round(height) };
}

/** Picks the model for a request, refusing anything outside the allowlist. */
export function resolveRequestModel(requested: unknown, config: AiPlayerConfig): string {
  if (typeof requested !== "string" || requested.trim().length === 0) {
    return config.model;
  }
  const candidate = requested.trim();
  if (!ALLOWED_MODEL_PATTERN.test(candidate)) {
    throw new AiPlayerError("invalid_response", "モデル ID は author/model の形式で指定してください。", 400);
  }
  return candidate;
}

/**
 * Per-cost-centre request accounting.
 *
 * A signed-in user is the key; the cap bounds how much of the operator's
 * balance one account can spend, independently of the provider's own limits.
 * Reset is a rolling UTC day rather than a sliding window because the intent is
 * "don't let one account run the balance down overnight".
 */
const dailyUsage = new Map<string, { day: string; count: number }>();
const DAILY_USAGE_TRACKED_USERS = 512;

function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Reserves one request for `userId`.
 *
 * Returns `null` when allowed, or the seconds until the cap resets.
 */
export function reserveDailyRequest(
  userId: string,
  cap: number,
  nowMs: number = Date.now(),
): number | null {
  if (cap <= 0) return null;
  const day = utcDay(nowMs);
  const entry = dailyUsage.get(userId);
  if (!entry || entry.day !== day) {
    dailyUsage.delete(userId);
    dailyUsage.set(userId, { day, count: 0 });
  }
  while (dailyUsage.size > DAILY_USAGE_TRACKED_USERS) {
    const oldest = dailyUsage.keys().next();
    if (oldest.done) break;
    dailyUsage.delete(oldest.value);
  }
  const current = dailyUsage.get(userId) as { day: string; count: number };
  if (current.count >= cap) {
    const nextDayMs = Date.parse(`${day}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
    return Math.max(1, Math.ceil((nextDayMs - nowMs) / 1000));
  }
  current.count += 1;
  return null;
}

/**
 * Extracts the assistant text from a chat-completions response.
 *
 * Tolerates the usual provider drift (string content, array of parts, a
 * `choices[0].message.reasoning` reasoning model, or a bare `output_text`).
 */
export function extractAssistantText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const message = (choice as Record<string, unknown>).message;
    if (!message || typeof message !== "object") continue;
    const content = (message as Record<string, unknown>).content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content;
    }
    if (Array.isArray(content)) {
      const parts = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
            return (part as Record<string, unknown>).text as string;
          }
          return "";
        })
        .join("");
      if (parts.trim().length > 0) return parts;
    }
    const reasoning = (message as Record<string, unknown>).reasoning;
    if (typeof reasoning === "string" && reasoning.trim().length > 0) {
      return reasoning;
    }
  }
  const outputText = record.output_text;
  return typeof outputText === "string" ? outputText : "";
}

export interface ChatCompletionRequest {
  model: string;
  messages: AiChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

/** Builds the provider request body. Exported for tests. */
export function buildChatCompletionRequest(
  model: string,
  messages: AiChatMessage[],
  options: { maxTokens?: number } = {},
): ChatCompletionRequest {
  return {
    model,
    messages,
    // Low temperature: the agent should follow the plan, not improvise.
    temperature: 0.3,
    // The reply is a small JSON object; 400 tokens is generous headroom and
    // caps worst-case spend per request on paid models. Vision rounds get a bit
    // more because the model tends to reason about the image before answering,
    // and a truncated reply would arrive as invalid JSON.
    max_tokens: options.maxTokens ?? 400,
  };
}

/**
 * Lifts the multimodal content into the message shape the provider expects.
 *
 * `AiChatMessage.content` is typed as a string for the text-only case; the
 * provider accepts an array of parts, so the cast is confined here.
 */
function toChatMessage(role: "system" | "user" | "assistant", content: AiMessageContent): AiChatMessage {
  return { role, content: content as unknown as string };
}

/** Builds the provider request for either mode. Exported for tests. */
export function buildRequestForMode(
  mode: AiPlayerMode,
  model: string,
  observation: AiPlayerObservation,
  visionSupported: boolean,
): ChatCompletionRequest {
  const systemPrompt = mode === "chat" ? AI_PLAYER_CHAT_SYSTEM_PROMPT : AI_PLAYER_SYSTEM_PROMPT;
  const text = buildObservationText(observation);
  const frame = visionSupported ? observation.frame?.dataUrl : undefined;
  return buildChatCompletionRequest(
    model,
    [
      toChatMessage("system", systemPrompt),
      toChatMessage("user", buildUserContent(text, frame)),
    ],
    { maxTokens: frame ? 700 : 400 },
  );
}

export interface DecideDependencies {
  fetchImpl?: typeof fetch;
  now?: () => number;
  config?: AiPlayerConfig;
}

/**
 * Turns the provider's error body into one short line a visitor can read.
 *
 * The status alone is useless ("HTTP 400" says nothing about *which* field the
 * gateway refused), but the raw body can echo the request and would be a way to
 * exfiltrate anything the server put in it. So: only `error.message` /
 * `error.metadata.error_type` / a plain `message`, stripped of control
 * characters, of the key, and of the data URL, then clipped.
 */
export function describeUpstreamError(body: unknown, apiKey: string): string {
  const readString = (value: unknown): string =>
    typeof value === "string" ? value : "";

  let detail = "";
  let errorType = "";
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const error = record.error;
    if (typeof error === "string") {
      detail = error;
    } else if (error && typeof error === "object") {
      const errorRecord = error as Record<string, unknown>;
      detail = readString(errorRecord.message);
      const metadata = errorRecord.metadata;
      if (metadata && typeof metadata === "object") {
        errorType = readString((metadata as Record<string, unknown>).error_type);
      }
      errorType = errorType || readString(errorRecord.type) || readString(errorRecord.code);
    }
    if (!detail) detail = readString(record.message) || readString(record.detail);
  } else if (typeof body === "string") {
    detail = body;
  }

  const scrub = (value: string): string => {
    let text = value;
    if (apiKey) text = text.split(apiKey).join("[key]");
    // A data URL in an echoed request would be megabytes of base64.
    text = text.replace(/data:[^\s"']{0,64};base64,[A-Za-z0-9+/=]+/g, "[image]");
    // Control characters (including newlines) would break the single log line.
    text = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return text.slice(0, 200);
  };

  const message = scrub(detail);
  const type = scrub(errorType);
  if (message && type && !message.includes(type)) return `${message} (${type})`;
  return message || type;
}

/** Maps an upstream status to the code the UI switches on. */
function errorCodeForStatus(status: number): AiPlayerErrorCode {
  if (status === 413) return "frame_too_large";
  if (status === 401 || status === 403) return "upstream_error";
  if (status === 402) return "budget_exceeded";
  return "upstream_error";
}

/** One provider call: the body that goes out and the parsed response text. */
interface UpstreamResult {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

async function callProvider(
  body: string,
  config: AiPlayerConfig,
  fetchImpl: typeof fetch,
): Promise<UpstreamResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        // Authorization is the only place the key appears: no logging, no
        // query string, no error text.
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new AiPlayerError(
      "upstream_error",
      aborted ? "AI プロバイダの応答が時間切れになりました。" : "AI プロバイダに接続できませんでした。",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const upstreamRetry = Number(response.headers.get("retry-after"));
    if (response.status === 429) {
      throw new AiPlayerError(
        "rate_limited",
        "AI プロバイダ側でリクエストが制限されています。しばらく待って再試行します。",
        429,
        Number.isFinite(upstreamRetry) && upstreamRetry > 0 ? upstreamRetry : 20,
      );
    }
    // The provider names the field it rejected; without that line a 400 is
    // indistinguishable from any other 400 and cannot be fixed.
    const errorBody = await response.json().catch(() => null);
    const detail = describeUpstreamError(errorBody, config.apiKey);
    const code = errorCodeForStatus(response.status);
    const head = code === "frame_too_large"
      ? "画面データが大きすぎるため AI プロバイダに拒否されました"
      : code === "budget_exceeded"
        ? "AI プロバイダの残高が不足しています"
        : "AI プロバイダがリクエストを拒否しました";
    throw new AiPlayerError(
      code,
      detail
        ? `${head} (HTTP ${response.status}): ${detail}`
        : `${head} (HTTP ${response.status})。`,
      502,
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new AiPlayerError("invalid_response", "AI プロバイダから JSON 以外の応答が返りました。", 502);
  }

  const text = extractAssistantText(parsed);
  if (!text.trim()) {
    throw new AiPlayerError("invalid_response", "AI プロバイダから空の応答が返りました。", 502);
  }

  const usageRecord = parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).usage
    ? (parsed as Record<string, unknown>).usage as Record<string, unknown>
    : null;
  const usage = usageRecord
    ? {
      inputTokens: Number(usageRecord.prompt_tokens),
      outputTokens: Number(usageRecord.completion_tokens),
    }
    : undefined;

  return {
    text,
    usage: usage && Number.isFinite(usage.inputTokens) ? usage : undefined,
  };
}

/**
 * Runs one decision round-trip.
 *
 * Throws `AiPlayerError` for anything the UI should explain in words: missing
 * key, rate limit, upstream failure, or an unusable reply.
 */
export async function requestAiPlayerDecision(
  request: AiPlayerDecideRequest,
  userId: string,
  deps: DecideDependencies = {},
): Promise<AiPlayerDecideResponse> {
  const config = deps.config ?? resolveAiPlayerConfig();
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;

  if (!config.apiKey) {
    throw new AiPlayerError(
      "missing_key",
      "AI プレイヤーが未設定です。サーバーに NUMES_API_KEY を設定してください。",
      503,
    );
  }

  const observation = sanitizeObservation(request?.observation);
  const model = resolveRequestModel(request?.model, config);
  const mode: AiPlayerMode = request?.mode === "chat" ? "chat" : "auto";

  const retryAfterSeconds = reserveDailyRequest(userId, config.dailyRequestCap, now());
  if (retryAfterSeconds !== null) {
    throw new AiPlayerError(
      "rate_limited",
      "このアカウントの 1 日あたりの AI リクエスト上限に達しました。",
      429,
      retryAfterSeconds,
    );
  }

  const visionSupported = modelSupportsVision(model);
  const requestBody = buildRequestForMode(mode, model, observation, visionSupported);
  const hasFrame = visionSupported && Boolean(observation.frame);

  try {
    const { text, usage } = await callProvider(JSON.stringify(requestBody), config, fetchImpl);
    // The client parses and validates the JSON shape (it owns the action table);
    // here only the raw text travels back, with usage for the UI.
    return { raw: text, usage };
  } catch (error) {
    // A model the allowlist believes in can still refuse images (wrong
    // endpoint, a provider that lost vision, a rejected data URL). Retrying
    // without the picture turns a dead session into a playable one, and the
    // flag tells the UI to say so instead of silently going blind.
    if (!hasFrame || !(error instanceof AiPlayerError)) throw error;
    if (error.code !== "upstream_error") throw error;
    const textOnly = buildRequestForMode(mode, model, { ...observation, frame: undefined }, false);
    const { text, usage } = await callProvider(JSON.stringify(textOnly), config, fetchImpl);
    return { raw: text, usage, droppedFrame: true };
  }
}

/**
 * Chat-mode round-trip: the visitor's message plus the current frame.
 *
 * Shares the transport with the auto loop so both modes behave identically on
 * errors, caps and timeouts; only the prompt and the presence of an instruction
 * differ.
 */
export async function requestAiPlayerChat(
  request: AiPlayerChatRequest,
  userId: string,
  deps: DecideDependencies = {},
): Promise<AiPlayerDecideResponse> {
  const message = sanitizeField(request?.message, 600);
  if (!message) {
    throw new AiPlayerError("invalid_response", "チャットのメッセージが空です。", 400);
  }
  const observation = sanitizeObservation(request?.observation);
  // The chat message is the instruction for this round; `instruction` in the
  // body is a convenience for callers that only have one field.
  const withInstruction: AiPlayerObservation = {
    ...observation,
    instruction: message,
    conversation: sanitizeObservation({ conversation: request.conversation }).conversation,
    frame: request.includeFrame === false ? undefined : observation.frame,
  };
  const config = deps.config ?? resolveAiPlayerConfig();
  return requestAiPlayerDecision(
    { observation: withInstruction, model: request.model, mode: "chat" },
    userId,
    { ...deps, config },
  );
}

export const aiPlayerInternals = {
  utcDay,
  dailyUsage,
  clearUsage: () => dailyUsage.clear(),
  ALLOWED_MODEL_PATTERN,
};
