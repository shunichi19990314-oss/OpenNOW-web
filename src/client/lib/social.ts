/**
 * Social capabilities ("friends and local co-op").
 *
 * The desktop client asks its core for `social.capabilities.get`; the core
 * answers that NVIDIA does not expose the GeForce NOW friends, presence or
 * invitation service to third-party clients, and that OpenNOW will not display
 * invented contacts or claim an invitation was sent. The Friends screen exists
 * to say that out loud and to offer the one thing that *does* work without the
 * provider: local co-op with the controllers plugged into this device.
 *
 * This module mirrors that contract so the web page cannot drift into showing
 * fake presence data, and so the wording is testable.
 */

export interface SocialCapabilities {
  friendsAvailable: boolean;
  presenceAvailable: boolean;
  invitesAvailable: boolean;
  /** Several gamepads on this device become separate players in-game. */
  localControllerJoin: boolean;
  /** Why the provider features are missing; shown verbatim. */
  reason: string;
}

/** Mirrors `native/opennow-core`'s `social.capabilities.get` answer. */
export const PROVIDER_SOCIAL_CAPABILITIES: SocialCapabilities = {
  friendsAvailable: false,
  presenceAvailable: false,
  invitesAvailable: false,
  localControllerJoin: true,
  reason:
    "NVIDIA does not expose the GeForce NOW friends, presence, or invitation service to "
    + "third-party clients. OpenNOW will not display invented contacts or claim invitations were sent.",
};

/** A controller that is plugged in right now, used for the local co-op slots. */
export interface LocalController {
  /** 1-based player slot. */
  slot: number;
  /** `Gamepad.id`, trimmed for display. */
  name: string;
}

/** Maximum simultaneous players the stream's local co-op supports. */
export const MAX_LOCAL_PLAYERS = 4;

/**
 * Turn `navigator.getGamepads()` into player slots.
 *
 * Browsers keep empty holes in the array for disconnected pads, so the index is
 * not a slot number: slots are assigned in order of the pads that are actually
 * connected, exactly like the desktop build's `ControllerInput.controllers`.
 */
export function toLocalControllerSlots(
  pads: ReadonlyArray<Gamepad | null | undefined> | null | undefined,
  /** Shown when the pad reports no usable name; the caller localises it. */
  fallbackName = "Gamepad",
): LocalController[] {
  if (!pads) return [];
  const controllers: LocalController[] = [];
  for (const pad of pads) {
    if (!pad) continue;
    // Chrome reports `Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 054c
    // Product: 0ce6)`; the product name is the readable half and the hex ids
    // are the only fallback for pads that ship none.
    const raw = (pad.id ?? "").trim();
    const productName = raw.split("(")[0]?.trim() ?? "";
    const hardware = (/\(([^)]+)\)/.exec(raw)?.[1] ?? "")
      .replace(/STANDARD GAMEPAD/i, "")
      .replace(/Vendor:\s*/i, "")
      .replace(/Product:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    controllers.push({ slot: controllers.length + 1, name: productName || hardware || fallbackName });
    if (controllers.length >= MAX_LOCAL_PLAYERS) break;
  }
  return controllers;
}

/** Whether a second player can join right now. */
export function hasSecondLocalPlayer(controllers: readonly LocalController[]): boolean {
  return controllers.length >= 2;
}

/** Which provider-backed actions the UI must present as unavailable. */
export function unavailableSocialActions(capabilities: SocialCapabilities): string[] {
  const actions: string[] = [];
  if (!capabilities.friendsAvailable) {
    actions.push("friends", "invite", "remove");
  }
  if (!capabilities.presenceAvailable) {
    actions.push("presence");
  }
  if (!capabilities.invitesAvailable) {
    actions.push("join", "message", "profile");
  }
  return [...new Set(actions)];
}
