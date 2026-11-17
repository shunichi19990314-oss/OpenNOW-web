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
 * One captured frame of the stream.
 *
 * Kept as a JPEG data URL because that is what the provider accepts without
 * multipart plumbing, and because the whole payload must survive JSON. Sending
 * an image is roughly 200-1200 tokens depending on size, which is why the frame
 * is downscaled before it is attached.
 */
export interface AiPlayerFrame {
  /** `data:image/jpeg;base64,...` */
  dataUrl: string;
  /** Pixel size after downscaling, for the prompt and for logging. */
  width: number;
  height: number;
}

/**
 * One frame of what the player can see and do.
 *
 * `frame` is optional: vision is what makes the AI stop repeating itself, but a
 * text-only provider still gets a usable (if blind) loop.
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
  /** Most recent capture of the stream, when vision is enabled. */
  frame?: AiPlayerFrame;
  /** The chat instruction from the visitor, when the AI is in chat mode. */
  instruction?: string;
  /** Recent conversation, oldest first (chat mode only). */
  conversation?: AiChatTurn[];
  /** What the loop did last round, so the model can avoid repeating it. */
  lastActions?: string[];
  /** Auto mode: how many consecutive rounds the same action was repeated. */
  repeatCount?: number;
}

export interface AiChatTurn {
  role: "user" | "assistant";
  text: string;
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
  /** Reply addressed to the visitor (chat mode; a status line in auto mode). */
  reply?: string;
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
  /**
   * Set when the screenshot was rejected upstream and the round was retried
   * as text-only.
   *
   * The request is still useful (the model can play from the observation), but
   * the visitor has to know the picture was dropped — otherwise a session that
   * silently stopped seeing the screen looks like the AI ignoring it.
   */
  droppedFrame?: boolean;
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
  /** Whether the configured model accepts image input. */
  vision: boolean;
}

/**
 * How the AI decides what to press.
 *
 * `auto`: observe → decide → press, on a timer.
 * `chat`: the visitor writes an instruction; the AI answers and acts on it.
 */
export type AiPlayerMode = "auto" | "chat";

/** Request body for `POST /api/ai/decide`. */
export interface AiPlayerDecideRequest {
  observation: AiPlayerObservation;
  /** Optional override picked in the UI; ignored when not in the allowlist. */
  model?: string;
  /** Defaults to `auto` when omitted. */
  mode?: AiPlayerMode;
}

/** Request body for `POST /api/ai/chat`. */
export interface AiPlayerChatRequest {
  observation: AiPlayerObservation;
  /** The visitor's message. */
  message: string;
  /** Earlier turns, oldest first. */
  conversation?: AiChatTurn[];
  model?: string;
  /** Whether to attach the captured frame (chat replies can be text-only). */
  includeFrame?: boolean;
}

/** Error codes the proxy returns so the UI can explain them. */
export type AiPlayerErrorCode =
  | "missing_key"
  | "disabled"
  | "rate_limited"
  | "upstream_error"
  | "invalid_response"
  | "budget_exceeded"
  | "frame_too_large";

export interface AiPlayerErrorBody {
  error: AiPlayerErrorCode;
  message: string;
  /** Seconds until the caller may retry (rate limiting). */
  retryAfterSeconds?: number;
}

export const AI_PLAYER_DECIDE_PATH = "/api/ai/decide";
export const AI_PLAYER_CHAT_PATH = "/api/ai/chat";
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
  // Image-capable choices, so "画面をAIに送る" can actually be used. Verified
  // against the catalogue's `input_modalities`; the first two are priced at 0.
  "qwen/qwen3.8-27b",
  "dealignai/glm-5.3-flash-uncensored-fp8",
  "uniboshi/kimi-k3-abliterated-v1",
] as const;

/**
 * Models known to accept image input, so the UI can warn before spending.
 *
 * Verified against Numes' own catalogue (`input_modalities`), because sending
 * an image part to a text-only model is a hard `400 invalid_request` — every
 * round fails, nothing plays, and the visitor only sees an error. That is
 * exactly what happened while `z-ai/glm-5.3` was listed here: its catalogue
 * entry is `text` only, so the screenshot has to be dropped for it.
 */
export const AI_PLAYER_VISION_MODELS = [
  "qwen/qwen3.8-27b",
  "dealignai/glm-5.3-flash-uncensored-fp8",
  "dealignai/deepseek-v4.1-flash-uncensored-fp8",
  "uniboshi/kimi-k3-abliterated-v1",
] as const;

/**
 * Model to switch to when the visitor turns screen-send on for a model that
 * cannot read images.
 *
 * Free on Numes today and image-capable, so the promise "the AI looks at the
 * screen" does not require the operator to add credits.
 */
export const AI_PLAYER_VISION_FALLBACK_MODEL = "qwen/qwen3.8-27b";

/**
 * Whether `model` can accept image parts.
 *
 * Lives in the shared module so the panel and the proxy agree: a mismatch here
 * is what produced a hard `400` on every round.
 */
export function modelSupportsVision(model: string): boolean {
  return (AI_PLAYER_VISION_MODELS as readonly string[]).includes(model);
}

/** Clamp on how long a single injected press may be held. */
export const AI_PLAYER_MAX_ACTION_MS = 2_000;
export const AI_PLAYER_MIN_ACTION_MS = 30;

/** Frame capture bounds. Bigger images cost more tokens for no extra detail. */
export const AI_PLAYER_FRAME_MAX_WIDTH = 960;
export const AI_PLAYER_FRAME_MAX_HEIGHT = 540;
export const AI_PLAYER_FRAME_JPEG_QUALITY = 0.6;
/** Hard cap on the encoded data URL, enforced on both sides. */
export const AI_PLAYER_FRAME_MAX_BYTES = 1_500_000;

/** Auto mode cadence, in milliseconds. */
export const AI_PLAYER_AUTO_INTERVAL_MS = 1_500;
/** A repeated identical action this many times forces a different choice. */
export const AI_PLAYER_REPEAT_LIMIT = 3;
