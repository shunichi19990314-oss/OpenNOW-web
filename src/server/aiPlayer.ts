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
import { AI_PLAYER_SYSTEM_PROMPT, buildAiPlayerPrompt } from "@shared/aiPlayerPrompt";
import {
  AI_PLAYER_DEFAULT_MODEL,
  type AiChatMessage,
  type AiPlayerDecideRequest,
  type AiPlayerDecideResponse,
  type AiPlayerErrorCode,
  type AiPlayerObservation,
  type AiPlayerStatus,
} from "@shared/aiPlayer";

const DEFAULT_BASE_URL = "https://api.numes.ai/api/v1";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_OBSERVATION_FIELD = 2_000;
const MAX_ACTIONS_OFFERED = 40;

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

/** Status shown in the settings panel. Never includes the key. */
export function describeAiPlayerStatus(config: AiPlayerConfig = resolveAiPlayerConfig()): AiPlayerStatus {
  return {
    configured: config.apiKey.length > 0,
    model: config.model,
    baseUrl: config.baseUrl,
    reason: config.apiKey.length > 0 ? undefined : "missing_key",
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
    throw new AiPlayerError("invalid_response", "observation must be an object", 400);
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
  return {
    game: sanitizeField(record.game, 120) || "unknown game",
    elapsedSeconds: Number.isFinite(elapsed) ? Math.max(0, Math.min(86_400, Math.round(elapsed))) : 0,
    plan: sanitizeField(record.plan, 400) || undefined,
    signals,
    availableActions,
  };
}

/** Picks the model for a request, refusing anything outside the allowlist. */
export function resolveRequestModel(requested: unknown, config: AiPlayerConfig): string {
  if (typeof requested !== "string" || requested.trim().length === 0) {
    return config.model;
  }
  const candidate = requested.trim();
  if (!ALLOWED_MODEL_PATTERN.test(candidate)) {
    throw new AiPlayerError("invalid_response", "model id is not in the expected author/model form", 400);
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
): ChatCompletionRequest {
  return {
    model,
    messages,
    // Low temperature: the agent should follow the plan, not improvise.
    temperature: 0.3,
    // The reply is a small JSON object; 400 tokens is generous headroom and
    // caps worst-case spend per request on paid models.
    max_tokens: 400,
  };
}

export interface DecideDependencies {
  fetchImpl?: typeof fetch;
  now?: () => number;
  config?: AiPlayerConfig;
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
      "AI player is not configured: set NUMES_API_KEY on the server.",
      503,
    );
  }

  const observation = sanitizeObservation(request?.observation);
  const model = resolveRequestModel(request?.model, config);

  const retryAfterSeconds = reserveDailyRequest(userId, config.dailyRequestCap, now());
  if (retryAfterSeconds !== null) {
    throw new AiPlayerError(
      "rate_limited",
      "Daily AI player request cap reached for this account.",
      429,
      retryAfterSeconds,
    );
  }

  const requestBody = buildChatCompletionRequest(model, [
    { role: "system", content: AI_PLAYER_SYSTEM_PROMPT },
    { role: "user", content: buildAiPlayerPrompt(observation) },
  ]);

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
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new AiPlayerError(
      "upstream_error",
      aborted ? "The AI provider took too long to answer." : "Could not reach the AI provider.",
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
        "The AI provider is rate limiting requests.",
        429,
        Number.isFinite(upstreamRetry) && upstreamRetry > 0 ? upstreamRetry : 20,
      );
    }
    // The provider's body may echo request details; only the status is safe.
    throw new AiPlayerError(
      "upstream_error",
      `The AI provider returned HTTP ${response.status}.`,
      502,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AiPlayerError("invalid_response", "The AI provider returned a non-JSON body.", 502);
  }

  const text = extractAssistantText(body);
  if (!text.trim()) {
    throw new AiPlayerError("invalid_response", "The AI provider returned an empty reply.", 502);
  }

  const usageRecord = body && typeof body === "object" && (body as Record<string, unknown>).usage
    ? (body as Record<string, unknown>).usage as Record<string, unknown>
    : null;
  const usage = usageRecord
    ? {
      inputTokens: Number(usageRecord.prompt_tokens),
      outputTokens: Number(usageRecord.completion_tokens),
    }
    : undefined;

  // The client parses and validates the JSON shape (it owns the action table);
  // here only the raw text travels back, with usage for the UI.
  return {
    raw: text,
    usage: usage && Number.isFinite(usage.inputTokens) ? usage : undefined,
  };
}

export const aiPlayerInternals = {
  utcDay,
  dailyUsage,
  clearUsage: () => dailyUsage.clear(),
  ALLOWED_MODEL_PATTERN,
};
