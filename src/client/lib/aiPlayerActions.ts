/**
 * Mapping between model-facing action names and gamepad packets.
 *
 * The model never sends raw bitmasks. It picks from this table, which makes the
 * prompt short (important because each token costs money) and keeps the set of
 * reachable inputs auditable: anything not listed here cannot be injected.
 *
 * Framing is the browser's job — `durationMs` is owned by the caller so the
 * table stays pure and testable.
 */
import {
  GAMEPAD_A,
  GAMEPAD_B,
  GAMEPAD_BACK,
  GAMEPAD_DPAD_DOWN,
  GAMEPAD_DPAD_LEFT,
  GAMEPAD_DPAD_RIGHT,
  GAMEPAD_DPAD_UP,
  GAMEPAD_LB,
  GAMEPAD_LS,
  GAMEPAD_RB,
  GAMEPAD_RS,
  GAMEPAD_START,
  GAMEPAD_X,
  GAMEPAD_Y,
} from "../platforms/gfn/inputProtocol";

export interface InjectedGamepadState {
  buttons: number;
  leftTrigger: number;
  rightTrigger: number;
  leftStickX: number;
  leftStickY: number;
  rightStickX: number;
  rightStickY: number;
}

export const NEUTRAL_GAMEPAD_STATE: InjectedGamepadState = {
  buttons: 0,
  leftTrigger: 0,
  rightTrigger: 0,
  leftStickX: 0,
  leftStickY: 0,
  rightStickX: 0,
  rightStickY: 0,
};

const STICK_FULL = 32767;
/** Camera nudge: enough to turn the view, small enough not to spin it. */
const LOOK_STEP = Math.round(STICK_FULL * 0.4);

type ActionBuilder = () => Partial<InjectedGamepadState>;

/**
 * Action name -> gamepad state.
 *
 * Names are the ones a player would say out loud, in both Japanese and English
 * ("a"/"決定", "b"/"戻る"), because the model sees the game title and often
 * answers in the player's language.
 */
const ACTION_TABLE: Record<string, ActionBuilder> = {
  a: () => ({ buttons: GAMEPAD_A }),
  決定: () => ({ buttons: GAMEPAD_A }),
  confirm: () => ({ buttons: GAMEPAD_A }),
  b: () => ({ buttons: GAMEPAD_B }),
  戻る: () => ({ buttons: GAMEPAD_B }),
  back: () => ({ buttons: GAMEPAD_B }),
  cancel: () => ({ buttons: GAMEPAD_B }),
  x: () => ({ buttons: GAMEPAD_X }),
  y: () => ({ buttons: GAMEPAD_Y }),
  start: () => ({ buttons: GAMEPAD_START }),
  スタート: () => ({ buttons: GAMEPAD_START }),
  pause: () => ({ buttons: GAMEPAD_START }),
  back_menu: () => ({ buttons: GAMEPAD_BACK }),
  select: () => ({ buttons: GAMEPAD_BACK }),
  dpad_up: () => ({ buttons: GAMEPAD_DPAD_UP }),
  上: () => ({ buttons: GAMEPAD_DPAD_UP }),
  up: () => ({ buttons: GAMEPAD_DPAD_UP }),
  dpad_down: () => ({ buttons: GAMEPAD_DPAD_DOWN }),
  下: () => ({ buttons: GAMEPAD_DPAD_DOWN }),
  down: () => ({ buttons: GAMEPAD_DPAD_DOWN }),
  dpad_left: () => ({ buttons: GAMEPAD_DPAD_LEFT }),
  左: () => ({ buttons: GAMEPAD_DPAD_LEFT }),
  left: () => ({ buttons: GAMEPAD_DPAD_LEFT }),
  dpad_right: () => ({ buttons: GAMEPAD_DPAD_RIGHT }),
  右: () => ({ buttons: GAMEPAD_DPAD_RIGHT }),
  right: () => ({ buttons: GAMEPAD_DPAD_RIGHT }),
  lb: () => ({ buttons: GAMEPAD_LB }),
  rb: () => ({ buttons: GAMEPAD_RB }),
  l3: () => ({ buttons: GAMEPAD_LS }),
  r3: () => ({ buttons: GAMEPAD_RS }),
  // Analog inputs. Movement is a full deflection: partial values only matter
  // for fine aiming, which the model cannot measure from a screenshot.
  move_forward: () => ({ leftStickY: STICK_FULL }),
  move_back: () => ({ leftStickY: -STICK_FULL }),
  move_left: () => ({ leftStickX: -STICK_FULL }),
  move_right: () => ({ leftStickX: STICK_FULL }),
  // Camera steps are deliberately *partial* (~40 %). A full-deflection flick
  // snaps the view to a new direction and makes a mostly-static screen look
  // identical, which is what let the earlier loop repeat itself forever.
  look_up: () => ({ rightStickY: LOOK_STEP }),
  look_down: () => ({ rightStickY: -LOOK_STEP }),
  look_left: () => ({ rightStickX: -LOOK_STEP }),
  look_right: () => ({ rightStickX: LOOK_STEP }),
  attack: () => ({ rightTrigger: 255 }),
  aim: () => ({ leftTrigger: 255 }),
  // Combos that a menu-driven game needs and that are awkward to express as a
  // sequence of separate taps.
  interact: () => ({ buttons: GAMEPAD_A }),
  menu: () => ({ buttons: GAMEPAD_START }),
  sprint: () => ({ leftStickY: STICK_FULL, buttons: GAMEPAD_LS }),
  jump: () => ({ buttons: GAMEPAD_A, rightTrigger: 0 }),
};

/** Names the prompt offers to the model, in a stable order. */
export const AI_PLAYER_ACTION_NAMES = Object.keys(ACTION_TABLE);

/**
 * Resolves an action name to a gamepad state.
 *
 * Unknown names return `null` rather than a neutral state: pressing nothing
 * while believing an action fired is worse than reporting that the model asked
 * for something impossible.
 */
export function resolveGamepadAction(action: string): InjectedGamepadState | null {
  const key = action.trim().toLowerCase();
  const builder = ACTION_TABLE[key];
  if (!builder) return null;
  return { ...NEUTRAL_GAMEPAD_STATE, ...builder() };
}

/** True when the name maps to a real input. */
export function isKnownGamepadAction(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACTION_TABLE, action.trim().toLowerCase());
}

/**
 * Turns a decision's action list into the sequence of states to send: each
 * action is pressed, then followed by a neutral state so the release is not
 * left to the game to infer.
 */
export function buildActionSequence(
  actions: Array<{ action: string; durationMs: number }>,
): Array<{ state: InjectedGamepadState; durationMs: number }> {
  const sequence: Array<{ state: InjectedGamepadState; durationMs: number }> = [];
  for (const action of actions) {
    const state = resolveGamepadAction(action.action);
    if (!state) continue;
    sequence.push({ state, durationMs: action.durationMs });
    sequence.push({ state: NEUTRAL_GAMEPAD_STATE, durationMs: 60 });
  }
  return sequence;
}
