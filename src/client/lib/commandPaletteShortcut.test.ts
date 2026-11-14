import { describe, expect, it } from "vitest";

import { isCommandPaletteShortcut, isTypingTarget } from "./commandPaletteShortcut";

function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "k",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("isCommandPaletteShortcut", () => {
  it("accepts Ctrl+K and Cmd+K", () => {
    expect(isCommandPaletteShortcut(keyEvent({ ctrlKey: true }))).toBe(true);
    expect(isCommandPaletteShortcut(keyEvent({ metaKey: true }))).toBe(true);
    expect(isCommandPaletteShortcut(keyEvent({ ctrlKey: true, key: "K" }))).toBe(true);
  });

  it("ignores bare K so in-game typing is untouched", () => {
    expect(isCommandPaletteShortcut(keyEvent({}))).toBe(false);
  });

  it("ignores modified combinations the game may use", () => {
    expect(isCommandPaletteShortcut(keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isCommandPaletteShortcut(keyEvent({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isCommandPaletteShortcut(keyEvent({ ctrlKey: true, key: "j" }))).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("treats form fields as typing surfaces", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const element = { tagName: tag.toUpperCase(), isContentEditable: false } as unknown as HTMLElement;
      expect(isTypingTarget(element)).toBe(true);
    }
  });

  it("accepts contenteditable and rejects non-elements", () => {
    const editable = { tagName: "DIV", isContentEditable: true } as unknown as HTMLElement;
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON", isContentEditable: false } as unknown as HTMLElement)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
