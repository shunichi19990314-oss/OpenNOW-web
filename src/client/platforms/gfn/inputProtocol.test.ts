import { describe, expect, it } from "vitest";

import { readGamepadAxes } from "./inputProtocol";

function mockGamepad(axes: number[]): Gamepad {
  return {
    axes,
    // Empty buttons array so readGamepadAxes falls through to the axes[4]/[5]
    // trigger path (some browsers report triggers only as axes).
    buttons: [],
  } as unknown as Gamepad;
}

describe("readGamepadAxes stick Y convention", () => {
  it("converts browser axes (down positive) to wire XInput convention (up positive)", () => {
    // Browser Gamepad API: pushing the stick UP reports axes[1] = -1.
    const up = readGamepadAxes(mockGamepad([0, -1, 0, 0, 0, 0]));
    expect(up.leftStickY).toBeCloseTo(1, 5);

    // Pushing DOWN reports axes[1] = +1 and must arrive negative on the wire.
    const down = readGamepadAxes(mockGamepad([0, 1, 0, 0, 0, 0]));
    expect(down.leftStickY).toBeCloseTo(-1, 5);

    // Same for the right (camera) stick.
    const rightUp = readGamepadAxes(mockGamepad([0, 0, 0, -1, 0, 0]));
    expect(rightUp.rightStickY).toBeCloseTo(1, 5);
  });

  it("keeps X axes (deadzone-rescaled) and reads triggers from axes", () => {
    const axes = readGamepadAxes(mockGamepad([0.5, 0, -0.25, 0, 0.75, 0.5]));
    // applyDeadzone rescales magnitude from the 0.15 deadzone edge to 1.0.
    expect(axes.leftStickX).toBeCloseTo((0.5 - 0.15) / 0.85, 5);
    expect(axes.rightStickX).toBeCloseTo(-(0.25 - 0.15) / 0.85, 5);
    expect(axes.leftTrigger).toBeCloseTo(0.75, 5);
    expect(axes.rightTrigger).toBeCloseTo(0.5, 5);
  });

  it("zeroes inputs inside the radial deadzone", () => {
    const axes = readGamepadAxes(mockGamepad([0.05, -0.05, 0, 0, 0, 0]));
    // toBeCloseTo also treats the -0 produced by negating a zeroed Y as 0.
    expect(axes.leftStickX).toBeCloseTo(0, 10);
    expect(axes.leftStickY).toBeCloseTo(0, 10);
  });
});
