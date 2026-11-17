/**
 * Prompt construction and reply parsing for the AI player.
 *
 * Kept pure and provider-agnostic so it runs in both the server (which builds
 * the request) and the browser (which validates the reply). Models drift, so
 * the reply is treated as untrusted input: every field is checked and every
 * action must be one the caller actually offered.
 */
import {
  AI_PLAYER_MAX_ACTION_MS,
  AI_PLAYER_MIN_ACTION_MS,
  AI_PLAYER_REPEAT_LIMIT,
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

/** Text the visitor sees: `reply`, `say`, or a duplicate of `plan`. */
function extractReply(record: Record<string, unknown>): string | undefined {
  for (const key of ["reply", "say", "message", "comment"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().slice(0, 600);
    }
  }
  return undefined;
}

/**
 * Validates a model reply against the observation it was asked to answer.
 *
 * Returns `decision: null` plus `problem` whenever the reply cannot be used,
 * so the caller can log one clear line instead of silently pressing nothing.
 *
 * A reply with a `reply`/`say` field but no actions is still a valid decision:
 * in chat mode the AI is allowed to explain itself and wait.
 */
export function parseAiPlayerDecision(
  raw: string,
  observation: AiPlayerObservation,
): ParseResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { decision: null, problem: "空の応答でした" };
  }
  const parsed = extractJsonBlock(raw);
  if (!parsed || typeof parsed !== "object") {
    return { decision: null, problem: "応答が JSON 形式ではありませんでした" };
  }
  const record = parsed as Record<string, unknown>;

  const plan = typeof record.plan === "string" ? record.plan.slice(0, 400) : "";
  const reply = extractReply(record);
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

  if (!plan && !reply && actions.length === 0) {
    return { decision: null, problem: "計画も操作も含まれていませんでした" };
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

  return { decision: { plan, actions, reply, usage } };
}

/**
 * Compact, token-cheap description of the current frame.
 *
 * The screenshot (when present) is attached separately; this text tells the
 * model what it cannot read off the image, and — importantly — what it did
 * last, so a stuck loop is visible to it as well as to the visitor.
 */
export function buildObservationText(observation: AiPlayerObservation): string {
  const lines = [
    `ゲーム: ${observation.game}`,
    `経過: ${Math.max(0, Math.round(observation.elapsedSeconds))} 秒`,
  ];
  if (observation.instruction) {
    lines.push(`ユーザーからの指示: ${observation.instruction}`);
  }
  if (observation.plan) {
    lines.push(`前回の計画: ${observation.plan}`);
  }
  if (observation.lastActions && observation.lastActions.length > 0) {
    lines.push(`前回の操作: ${observation.lastActions.join(", ")}`);
  }
  if (observation.signals && observation.signals.length > 0) {
    lines.push(`状況: ${observation.signals.slice(0, 6).join(", ")}`);
  }
  if (observation.repeatCount && observation.repeatCount >= AI_PLAYER_REPEAT_LIMIT) {
    lines.push(
      `警告: 同じ操作を ${observation.repeatCount} 回連続で繰り返しています。`
      + "画面の変化を確認し、別の操作を選ぶか、前回と違う方向へ動いてください。",
    );
  }
  lines.push(`使用できる操作: ${observation.availableActions.join(", ")}`);
  if (observation.frame) {
    lines.push("最新の画面画像を添付します。この画像から読み取れる状況に基づいて判断してください。");
  } else {
    lines.push("画面画像はありません。見えない状況を推測しすぎないでください。");
  }
  if (observation.conversation && observation.conversation.length > 0) {
    lines.push("これまでの会話:");
    for (const turn of observation.conversation.slice(-6)) {
      lines.push(`${turn.role === "user" ? "ユーザー" : "AI"}: ${turn.text}`);
    }
  }
  return lines.join("\n");
}

const JSON_SCHEMA = [
  "必ず次の JSON だけを返してください(前後に文章を付けない):",
  '{"reply": string, "plan": string, "actions": [{"action": string, "durationMs": number}]}',
].join("\n");

const COMMON_RULES = [
  "操作はゲームパッド入力として送られます。",
  "使用できる操作リストにない名前は使わないでください。",
  "- 1 回に 1〜3 個まで。各操作は 30〜2000 ms 押します。",
  "- 画面を見て、前回と同じ操作を繰り返さないでください。",
  "- 迷ったら短く押して結果を確かめ、次のラウンドで調整してください。",
  "- 文字列入力や画面外の操作はできません。",
].join("\n");

export const AI_PLAYER_SYSTEM_PROMPT = [
  "あなたは家庭用ゲームのコントローラを操作する自動プレイAIです。",
  JSON_SCHEMA,
  "reply には、いま何をしているかを日本語で 1 文だけ書いてください(例: 「メニューを開くため決定を押します」)。",
  COMMON_RULES,
].join("\n");

export const AI_PLAYER_CHAT_SYSTEM_PROMPT = [
  "あなたは家庭用ゲームのコントローラを操作するAIです。ユーザーと日本語で会話しながら操作します。",
  JSON_SCHEMA,
  "reply には、ユーザーへの返答を日本語で書いてください。操作を行わない場合(質問への回答だけ等)は actions を空にしてください。",
  COMMON_RULES,
  "- ユーザーの指示が曖昧なときは、まず安全な操作を 1 つ試し、reply で何をしたか伝えてください。",
].join("\n");

/** Message content in the shape providers expect for multimodal input. */
export type AiMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type AiMessageContent = string | AiMessageContentPart[];

/**
 * Builds the multimodal content for one turn.
 *
 * Order matters for some providers: text first, then the image, so the
 * instruction is read before the picture.
 */
export function buildUserContent(
  text: string,
  frameDataUrl: string | undefined,
): AiMessageContent {
  if (!frameDataUrl) return text;
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: frameDataUrl } },
  ];
}
