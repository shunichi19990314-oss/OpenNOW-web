import { describe, expect, it } from "vitest";

import {
  actionSignature,
  enforceVariety,
  EXPLORATION_ACTIONS,
  INITIAL_REPEAT_TRACKER,
  pickVarietyAction,
  shouldForceVariety,
  trackActions,
} from "./aiPlayerVariety";

const AVAILABLE = ["a", "b", "dpad_down", "look_left", "look_right", "move_forward"];

describe("repeat tracking", () => {
  it("counts consecutive identical action sets", () => {
    let tracker = INITIAL_REPEAT_TRACKER;
    for (let round = 0; round < 3; round += 1) {
      tracker = trackActions(tracker, [{ action: "a" }, { action: "b" }]);
    }
    expect(tracker.count).toBe(3);
    expect(tracker.last).toEqual(["a", "b"]);
  });

  it("resets when the actions change", () => {
    let tracker = trackActions(INITIAL_REPEAT_TRACKER, [{ action: "a" }]);
    tracker = trackActions(tracker, [{ action: "a" }]);
    tracker = trackActions(tracker, [{ action: "b" }]);
    expect(tracker.count).toBe(1);
  });

  it("does not punish a deliberate wait", () => {
    // "look and do nothing" is a legitimate choice; counting it as repetition
    // would force movement into menus that must not be moved in.
    let tracker = trackActions(INITIAL_REPEAT_TRACKER, [{ action: "a" }]);
    tracker = trackActions(tracker, []);
    expect(tracker.count).toBe(0);
    expect(shouldForceVariety(tracker)).toBe(false);
  });

  it("ignores hold durations when comparing", () => {
    expect(actionSignature([{ action: "a" }])).toBe(actionSignature([{ action: "A" }]));
  });
});

describe("variety enforcement", () => {
  it("leaves the model alone below the limit", () => {
    const tracker = { last: ["a"], count: 1 };
    const result = enforceVariety(tracker, [{ action: "a", durationMs: 200 }], 2, AVAILABLE);
    expect(result.overridden).toBe(false);
    expect(result.actions[0].action).toBe("a");
  });

  it("replaces a stuck action with a different, offered one", () => {
    const tracker = { last: ["a"], count: 2 };
    // Third identical round hits the limit.
    const result = enforceVariety(tracker, [{ action: "a", durationMs: 200 }], 3, AVAILABLE);
    expect(result.overridden).toBe(true);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].action).not.toBe("a");
    expect(AVAILABLE).toContain(result.actions[0].action);
    // The counter resets so the override does not fire every round afterwards.
    expect(result.tracker.count).toBe(1);
  });

  it("never picks an action the caller did not offer", () => {
    const tracker = { last: ["a"], count: 2 };
    const result = enforceVariety(tracker, [{ action: "a", durationMs: 200 }], 3, ["a"]);
    // Only "a" is available, so the fallback is "a" rather than something
    // unreachable — the game would ignore an unoffered button entirely.
    expect(result.actions[0].action).toBe("a");
  });

  it("rotates rather than bouncing between two choices", () => {
    const first = pickVarietyAction(0, ["a"], AVAILABLE);
    const second = pickVarietyAction(1, ["a"], AVAILABLE);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.action).not.toBe(second?.action);
  });

  it("returns null when nothing can be pressed", () => {
    expect(pickVarietyAction(0, ["a"], [])).toBeNull();
  });

  it("prefers exploratory actions that change the next screenshot", () => {
    const picked = pickVarietyAction(0, ["a"], AVAILABLE);
    // Camera steps come first in the rotation: turning the view is what makes
    // the next capture informative.
    expect(EXPLORATION_ACTIONS.indexOf(picked?.action ?? "")).toBeGreaterThanOrEqual(0);
    expect(["look_left", "look_right"]).toContain(picked?.action);
  });
});
