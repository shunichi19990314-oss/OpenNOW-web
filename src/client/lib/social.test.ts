import { describe, expect, it } from "vitest";

import {
  MAX_LOCAL_PLAYERS,
  PROVIDER_SOCIAL_CAPABILITIES,
  hasSecondLocalPlayer,
  toLocalControllerSlots,
  unavailableSocialActions,
} from "./social";

/**
 * The desktop build refuses to invent friends, presence or invitations because
 * NVIDIA exposes none of them to third-party clients. These guard the same
 * contract on the web side.
 */
describe("social capabilities", () => {
  it("reports provider social features as unavailable but local co-op as usable", () => {
    expect(PROVIDER_SOCIAL_CAPABILITIES.friendsAvailable).toBe(false);
    expect(PROVIDER_SOCIAL_CAPABILITIES.presenceAvailable).toBe(false);
    expect(PROVIDER_SOCIAL_CAPABILITIES.invitesAvailable).toBe(false);
    expect(PROVIDER_SOCIAL_CAPABILITIES.localControllerJoin).toBe(true);
    expect(PROVIDER_SOCIAL_CAPABILITIES.reason).toContain("NVIDIA");
  });

  it("lists every provider action the UI must mark unavailable", () => {
    const actions = unavailableSocialActions(PROVIDER_SOCIAL_CAPABILITIES);
    expect(actions).toEqual(
      expect.arrayContaining(["friends", "invite", "remove", "presence", "join", "message", "profile"]),
    );
    // No duplicates: each action is reported once even when several flags are off.
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("keeps local co-op available when the provider features are not", () => {
    const actions = unavailableSocialActions(PROVIDER_SOCIAL_CAPABILITIES);
    expect(actions).not.toContain("localCoop");
  });
});

describe("local controller slots", () => {
  const pad = (id: string): Gamepad => ({ id } as Gamepad);

  it("numbers connected pads in order and ignores the holes browsers keep", () => {
    const slots = toLocalControllerSlots([null, pad("(STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"), undefined, pad("Xbox Wireless Controller (STANDARD GAMEPAD)")]);
    expect(slots.map((slot) => slot.slot)).toEqual([1, 2]);
    expect(slots[0].name).toBe("054c 0ce6");
    expect(slots[1].name).toBe("Xbox Wireless Controller");
  });

  it("caps the slots at four players", () => {
    const pads = Array.from({ length: 6 }, (_unused, index) => pad(`Pad ${index}`));
    expect(toLocalControllerSlots(pads)).toHaveLength(MAX_LOCAL_PLAYERS);
  });

  it("falls back to a readable name and tolerates missing input", () => {
    expect(toLocalControllerSlots([pad("   ")])[0].name).toBe("Gamepad");
    expect(toLocalControllerSlots([pad("(STANDARD GAMEPAD)")], "コントローラー")[0].name).toBe("コントローラー");
    expect(toLocalControllerSlots(null)).toEqual([]);
    expect(toLocalControllerSlots(undefined)).toEqual([]);
  });

  it("only offers player two once a second pad is connected", () => {
    expect(hasSecondLocalPlayer([])).toBe(false);
    expect(hasSecondLocalPlayer([{ slot: 1, name: "Pad" }])).toBe(false);
    expect(hasSecondLocalPlayer([{ slot: 1, name: "Pad" }, { slot: 2, name: "Pad" }])).toBe(true);
  });
});
