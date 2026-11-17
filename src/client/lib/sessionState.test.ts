import { describe, expect, it } from "vitest";

import { toLaunchErrorState } from "./sessionState";
import ja from "../../../locales/ja.json";
import en from "../../../locales/en.json";

/**
 * The duplicate-session screen used to name no game and offer no action, which
 * is how "the home screen shows nothing, but launching says a session is
 * running" became a dead end.
 */

const errorsJa = ja.errors as Record<string, string>;
const errorsEn = en.errors as Record<string, string>;
const t = (key: string, values: Record<string, string | number | boolean | null | undefined> = {}): string => {
  const template = errorsJa[key.split(".").pop() ?? key] ?? errorsEn[key] ?? key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, token: string) => String(values[token] ?? ""));
};

const GAME = { title: "崩壊:スターレイル", membershipTierLabel: "無料" };

describe("duplicate session launch error", () => {
  it("is detected from the machine-readable code, not the prose", () => {
    // The server returns `SessionError.errorType`; a localized or reworded
    // message must not change the classification.
    const withCode = Object.assign(new Error("起動できませんでした。"), {
      errorCode: "SessionLimitExceeded",
      httpStatus: 502,
    });
    const state = toLaunchErrorState(t, withCode, "queue", GAME);
    expect(state.title).toContain("重複");
    expect(state.action).toBe("end-active-session");
  });

  it("is detected from the upstream status description", () => {
    const fromProse = Object.assign(new Error("launch failed"), {
      errorCode: "SessionServerErrorBegin",
      statusDescription: "DuplicateSessionDetected",
    });
    expect(toLaunchErrorState(t, fromProse, "queue", GAME).action).toBe("end-active-session");
  });

  it("also catches the per-device and max-session codes", () => {
    for (const gfnErrorCode of [3237093682, 3237093715]) {
      const state = toLaunchErrorState(
        t,
        Object.assign(new Error("launch failed"), { gfnErrorCode }),
        "queue",
        GAME,
      );
      expect(state.action, String(gfnErrorCode)).toBe("end-active-session");
    }
  });

  it("does not misread an unrelated failure as a session conflict", () => {
    const state = toLaunchErrorState(
      t,
      Object.assign(new Error("SessionInsufficientPlayabilityLevel"), { errorCode: "SessionInsufficientPlayabilityLevel" }),
      "queue",
      GAME,
    );
    expect(state.action).toBeUndefined();
  });

  it("names the game the visitor was launching", () => {
    const state = toLaunchErrorState(t, new Error("SESSION_LIMIT_EXCEEDED"), "queue", GAME);
    // Without the game title the message is identical for every launch, so the
    // visitor cannot tell which title is holding the session.
    expect(state.description).toContain("崩壊:スターレイル");
    expect(state.description).toContain("別のクラウドセッション");
  });

  it("offers the action that resolves it", () => {
    const state = toLaunchErrorState(t, new Error("DUPLICATE SESSION"), "queue", GAME);
    expect(state.action).toBe("end-active-session");
    expect(state.actionLabel).toBe(errorsJa.duplicateSessionEndAction);
    // The old copy told the visitor to wait for a timeout and gave no button.
    expect(state.description).not.toContain("タイムアウトになるまで待って");
  });

  it("falls back to the generic wording when the game is unknown", () => {
    const state = toLaunchErrorState(t, new Error("DUPLICATE SESSION"), "queue", null);
    expect(state.description).toBe(errorsJa.duplicateSessionDescription);
    expect(state.action).toBe("end-active-session");
  });

  it("keeps other launch failures unchanged", () => {
    const state = toLaunchErrorState(t, new Error("boom"), "queue", GAME);
    expect(state.action).toBeUndefined();
    expect(state.title).toBe(errorsJa.launchFailedTitle);
  });
});
