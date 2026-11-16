/**
 * Parser for the model's reply.
 *
 * Kept pure and separate from the network layer: models drift, so the reply is
 * treated as untrusted input and every field is validated against the actions
 * the caller actually offered. A hallucinated button name must never reach the
 * gamepad encoder — the encoder would happily send `undefined` and the player
 * would look broken rather than the model.
 */
import {
  AI_PLAYER_MAX_ACTION_MS,
  AI_PLAYER_MIN_ACTION_MS,
  type AiPlayerAction,
  type AiPlayerDecision,
  type AiPlayerObservation,
} from "./aiPlayer";

export interface ParseResult {
  decision: AiPlayerDecision | null;
  /** Human-readable reason the reply was rejected (for the UI log). */
  problem?: string;
}

const ACTION_NAME_PATTERN = /^[a-z0-9_:+-]{1,32}$/i;

function extractJsonBlock(raw: string): unknown {
  const trimmed = raw.trim();
  // Models like to wrap JSON in a fenced code block even when told not to.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Last resort: the first {...} span, which survives "Here you go: {...}".
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeAction(
  value: unknown,
  allowed: Set<string>,
): AiPlayerAction | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const rawName = typeof record.action === "string"
    ? record.action
    : typeof record.button === "string"
      ? record.button
      : "";
  const action = rawName.trim().toLowerCase();
  if (!ACTION_NAME_PATTERN.test(action)) return null;

  // Trust boundary: the model may only pick actions the caller offered. When
  // the caller offers nothing, fall back to accepting any syntactically valid
  // name (the browser maps it against the gamepad table and drops unknowns).
  if (allowed.size > 0 && !allowed.has(action)) return null;

  const rawDuration = Number(record.durationMs ?? record.duration ?? record.ms);
  const durationMs = Number.isFinite(rawDuration) && rawDuration > 0
    ? Math.max(AI_PLAYER_MIN_ACTION_MS, Math.min(AI_PLAYER_MAX_ACTION_MS, Math.round(rawDuration)))
    : 250;

  const note = typeof record.note === "string" ? record.note.slice(0, 160) : undefined;
  return { action, durationMs, note };
}

/**
 * Validates a model reply against the observation it was asked to answer.
 *
 * Returns `decision: null` plus `problem` whenever the reply cannot be used,
 * so the caller can log one clear line instead of silently pressing nothing.
 */
export function parseAiPlayerDecision(
  raw: string,
  observation: AiPlayerObservation,
): ParseResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { decision: null, problem: "empty reply" };
  }
  const parsed = extractJsonBlock(raw);
  if (!parsed || typeof parsed !== "object") {
    return { decision: null, problem: "reply was not JSON" };
  }
  const record = parsed as Record<string, unknown>;

  const plan = typeof record.plan === "string" ? record.plan.slice(0, 400) : "";
  const rawActions = Array.isArray(record.actions)
    ? record.actions
    : Array.isArray(record.buttons)
      ? record.buttons
      : [];

  const allowed = new Set(observation.availableActions.map((name) => name.toLowerCase()));
  const actions: AiPlayerAction[] = [];
  for (const candidate of rawActions.slice(0, 8)) {
    const action = normalizeAction(candidate, allowed);
    if (action) actions.push(action);
  }

  if (!plan && actions.length === 0) {
    return { decision: null, problem: "no plan and no usable actions" };
  }

  const usageRecord = record.usage && typeof record.usage === "object"
    ? record.usage as Record<string, unknown>
    : null;
  const usage = usageRecord
    ? {
      inputTokens: Number.isFinite(Number(usageRecord.inputTokens ?? usageRecord.prompt_tokens))
        ? Number(usageRecord.inputTokens ?? usageRecord.prompt_tokens)
        : undefined,
      outputTokens: Number.isFinite(Number(usageRecord.outputTokens ?? usageRecord.completion_tokens))
        ? Number(usageRecord.outputTokens ?? usageRecord.completion_tokens)
        : undefined,
    }
    : undefined;

  return { decision: { plan, actions, usage } };
}

/** Compact, token-cheap description of the current frame. */
export function buildAiPlayerPrompt(observation: AiPlayerObservation): string {
  const lines = [
    `Game: ${observation.game}`,
    `Elapsed: ${Math.max(0, Math.round(observation.elapsedSeconds))}s`,
  ];
  if (observation.plan) {
    lines.push(`Previous plan: ${observation.plan}`);
  }
  if (observation.signals && observation.signals.length > 0) {
    lines.push(`Signals: ${observation.signals.slice(0, 6).join(", ")}`);
  }
  lines.push(`Available actions: ${observation.availableActions.join(", ")}`);
  return lines.join("\n");
}

export const AI_PLAYER_SYSTEM_PROMPT = [
  "You are playing a video game through a gamepad. Respond with JSON only.",
  'Schema: {"plan": string, "actions": [{"action": string, "durationMs": number}]}',
  "Rules:",
  "- Use only actions from the Available actions list.",
  "- One to three actions per turn; each is held for 30-2000 ms.",
  "- Prefer short taps over long holds unless the game needs a sustained input.",
  "- Never invent game state you cannot see; if unsure, repeat a safe action.",
].join("\n");
