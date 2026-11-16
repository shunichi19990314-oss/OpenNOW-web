/**
 * Contract for the AI player, shared by the browser loop and the server proxy.
 *
 * Why a proxy at all: the API key belongs to the operator's Numes account and
 * is billed per token. It must never be shipped to the browser — otherwise any
 * visitor of the deployed app could read it from the bundle or the network tab
 * and spend the balance. The browser therefore asks this app's own server for a
 * decision, and the server is the only place that knows the key.
 */

/** Subset of the OpenAI chat-completions shape that the proxy relies on. */
export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * One frame of what the player can see and do.
 *
 * Deliberately small: model round-trips are the bottleneck, so the browser
 * sends a compact state block rather than screenshots or full game state.
 */
export interface AiPlayerObservation {
  /** Game title, so the model knows what it is playing. */
  game: string;
  /** Elapsed seconds in this session. */
  elapsedSeconds: number;
  /** The model's own previous plan, echoed back for continuity. */
  plan?: string;
  /** Damage taken or other signals that the current plan is not working. */
  signals?: string[];
  /** Actions the caller allows the model to choose from. */
  availableActions: string[];
}

/** A single decoded action the browser will apply to the gamepad. */
export interface AiPlayerAction {
  /** Action name, one of `availableActions` (or a primitive button name). */
  action: string;
  /** How long to hold it, in milliseconds. */
  durationMs: number;
  /** Optional short reasoning, surfaced in the UI log. */
  note?: string;
}

export interface AiPlayerDecision {
  /** Short natural-language plan the model wants to follow next. */
  plan: string;
  actions: AiPlayerAction[];
  /** Token usage reported by the provider, for the settings panel. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * What the proxy returns: the model's text, unparsed.
 *
 * Parsing stays in the browser because the action table lives there. Shipping
 * the raw text also keeps the trust boundary explicit — the server does not
 * vouch for the reply's shape.
 */
export interface AiPlayerDecideResponse {
  raw: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AiPlayerStatus {
  /** Server has a key configured (never reveals the key itself). */
  configured: boolean;
  /** Model id that will be used. */
  model: string;
  /** Base URL of the provider (no credentials). */
  baseUrl: string;
  /** Why the feature is unavailable, when `configured` is false. */
  reason?: "missing_key" | "disabled";
}

/** Request body for `POST /api/ai/decide`. */
export interface AiPlayerDecideRequest {
  observation: AiPlayerObservation;
  /** Optional override picked in the UI; ignored when not in the allowlist. */
  model?: string;
}

/** Error codes the proxy returns so the UI can explain them. */
export type AiPlayerErrorCode =
  | "missing_key"
  | "disabled"
  | "rate_limited"
  | "upstream_error"
  | "invalid_response"
  | "budget_exceeded";

export interface AiPlayerErrorBody {
  error: AiPlayerErrorCode;
  message: string;
  /** Seconds until the caller may retry (rate limiting). */
  retryAfterSeconds?: number;
}

export const AI_PLAYER_DECIDE_PATH = "/api/ai/decide";
export const AI_PLAYER_STATUS_PATH = "/api/ai/status";
export const AI_PLAYER_MODELS_PATH = "/api/ai/models";

/** Default model: one of the free, tool-capable models on Numes. */
export const AI_PLAYER_DEFAULT_MODEL = "z-ai/glm-5.3";

/**
 * Models the settings UI offers.
 *
 * All of them are free on Numes today (prompt and completion priced at 0), so
 * an operator who pastes a key can try the feature without adding credits.
 */
export const AI_PLAYER_SUGGESTED_MODELS = [
  "z-ai/glm-5.3",
  "deepseek/deepseek-v4.1-flash",
  "moonshotai/kimi-k3.1-pro",
] as const;

/** Clamp on how long a single injected press may be held. */
export const AI_PLAYER_MAX_ACTION_MS = 2_000;
export const AI_PLAYER_MIN_ACTION_MS = 30;
