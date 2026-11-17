/**
 * Keeps the AI from pressing the same button forever.
 *
 * The reported failure was "the AI works but does the same thing over and over".
 * Vision alone does not fix that: a model looking at a mostly-static menu will
 * still pick the safe option, and a text-only model has nothing else to go on.
 * So the repetition is handled twice — the prompt is told what it just did, and
 * this module enforces a rotation when the model ignores that.
 *
 * Pure functions, no timers: the loop owns scheduling.
 */
import {
  AI_PLAYER_REPEAT_LIMIT,
  type AiPlayerAction,
} from "../../shared/aiPlayer";

/**
 * A deterministic rotation to fall back on.
 *
 * Ordered so that "look around" (which changes what the next screenshot shows)
 * comes before more pushing. Each entry is short: exploration should not freeze
 * the game for two seconds at a time.
 */
export const EXPLORATION_ACTIONS: readonly string[] = [
  "look_right",
  "look_left",
  "move_forward",
  "dpad_down",
  "a",
  "move_right",
  "look_up",
  "dpad_up",
  "b",
  "move_left",
  "look_down",
  "dpad_left",
];

export interface RepeatTracker {
  /** Actions from the previous round, in order. */
  last: string[];
  /** How many consecutive rounds produced the same action set. */
  count: number;
}

export const INITIAL_REPEAT_TRACKER: RepeatTracker = { last: [], count: 0 };

/** Stable key for a round's action list, ignoring hold durations. */
export function actionSignature(actions: Array<Pick<AiPlayerAction, "action">>): string {
  return actions.map((entry) => entry.action.toLowerCase()).join("+");
}

/**
 * Updates the tracker with the actions the model chose.
 *
 * Empty action lists are not counted as repetition: "wait and look" is a
 * legitimate choice and should not consume the allowance.
 */
export function trackActions(
  tracker: RepeatTracker,
  actions: Array<Pick<AiPlayerAction, "action">>,
): RepeatTracker {
  const signature = actionSignature(actions);
  if (!signature) {
    return { last: [], count: 0 };
  }
  if (signature === actionSignature(tracker.last.map((action) => ({ action })))) {
    return { last: actions.map((entry) => entry.action), count: tracker.count + 1 };
  }
  return { last: actions.map((entry) => entry.action), count: 1 };
}

/** True when the model has been stuck long enough to override it. */
export function shouldForceVariety(tracker: RepeatTracker): boolean {
  return tracker.count >= AI_PLAYER_REPEAT_LIMIT;
}

/**
 * Picks a fallback action that is different from what was just pressed.
 *
 * Uses the round number as the cursor so successive overrides do not bounce
 * between the same two actions, and skips names the caller did not offer.
 */
export function pickVarietyAction(
  round: number,
  lastActions: string[],
  availableActions: readonly string[],
): AiPlayerAction | null {
  if (availableActions.length === 0) return null;
  const previouslyUsed = new Set(lastActions.map((action) => action.toLowerCase()));
  const offered = new Set(availableActions.map((action) => action.toLowerCase()));
  const rotation = EXPLORATION_ACTIONS.filter((action) => offered.has(action));
  const pool = rotation.length > 0 ? rotation : availableActions;
  for (let offset = 0; offset < pool.length; offset += 1) {
    const candidate = pool[(Math.abs(round) + offset) % pool.length].toLowerCase();
    if (!previouslyUsed.has(candidate)) {
      return {
        action: candidate,
        durationMs: 220,
        note: "同じ操作が続いたため、別の操作に切り替えました",
      };
    }
  }
  // Everything has been tried this round: still move rather than stand still.
  return { action: pool[0].toLowerCase(), durationMs: 220, note: "操作を切り替えました" };
}

/**
 * Applies the override when the model is stuck.
 *
 * Returns the actions to send plus the tracker for the next round. Called by the
 * loop, and unit-tested without any network or timer involved.
 */
export function enforceVariety(
  tracker: RepeatTracker,
  decisionActions: AiPlayerAction[],
  round: number,
  availableActions: readonly string[],
): { actions: AiPlayerAction[]; tracker: RepeatTracker; overridden: boolean } {
  const nextTracker = trackActions(tracker, decisionActions);
  if (!shouldForceVariety(nextTracker)) {
    return { actions: decisionActions, tracker: nextTracker, overridden: false };
  }
  const fallback = pickVarietyAction(round, nextTracker.last, availableActions);
  if (!fallback) {
    return { actions: decisionActions, tracker: nextTracker, overridden: false };
  }
  return {
    actions: [fallback],
    // Reset the counter so the next override needs another full streak; leaving
    // it high would override every round from then on.
    tracker: { last: [fallback.action], count: 1 },
    overridden: true,
  };
}
