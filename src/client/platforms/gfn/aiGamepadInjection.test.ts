import { describe, expect, it } from "vitest";

import { GAMEPAD_A, GAMEPAD_DPAD_DOWN, InputEncoder } from "./inputProtocol";

/**
 * Guards the wire format the AI player depends on.
 *
 * A live session ran 51 decision rounds with the game never reacting. Two
 * independent mistakes caused it: packets were addressed to a controller slot
 * that had never been announced (its bitmap bit stayed clear), and the injected
 * pad never sent a keepalive, so the remote side treated it as disconnected.
 * The AI now delegates to the touch-gamepad path, which already does both.
 *
 * These checks pin the packet-level facts; the WebRTC plumbing itself needs a
 * real session and is covered by the sink/keepalive tests in the loop suite.
 */

const SLOT0_BITMAP = (1 << 0) | (1 << 8);

function encode(buttons: number, bitmap: number): Uint8Array {
  return new InputEncoder().encodeGamepadState(
    {
      controllerId: 0,
      buttons,
      leftTrigger: 0,
      rightTrigger: 0,
      leftStickX: 0,
      leftStickY: 0,
      rightStickX: 0,
      rightStickY: 0,
      connected: true,
      timestampUs: BigInt(1),
    },
    bitmap,
    false,
  );
}

/** Finds a little-endian u16 anywhere in the packet, behind the v3 framing. */
function containsU16LE(packet: Uint8Array, value: number): boolean {
  for (let index = 0; index + 1 < packet.length; index += 1) {
    if (packet[index] === (value & 0xff) && packet[index + 1] === ((value >> 8) & 0xff)) {
      return true;
    }
  }
  return false;
}

describe("injected gamepad packets", () => {
  it("differs only by the announced-slot bitmap", () => {
    const withPad = encode(GAMEPAD_A, SLOT0_BITMAP);
    const withoutPad = encode(GAMEPAD_A, 0);
    // If these were identical the bitmap would not be reaching the wire at all,
    // which is exactly the bug: a controller nobody announced.
    expect(withPad).not.toEqual(withoutPad);
    expect(withPad.length).toBe(withoutPad.length);
    expect(containsU16LE(withPad, SLOT0_BITMAP)).toBe(true);
  });

  it("carries the button bits the action table resolves", () => {
    expect(containsU16LE(encode(GAMEPAD_A, SLOT0_BITMAP), GAMEPAD_A)).toBe(true);
    expect(containsU16LE(encode(GAMEPAD_DPAD_DOWN, SLOT0_BITMAP), GAMEPAD_DPAD_DOWN)).toBe(true);
  });
});
