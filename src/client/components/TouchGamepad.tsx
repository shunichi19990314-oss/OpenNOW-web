import { useCallback, useEffect, useRef, type JSX } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  GAMEPAD_A,
  GAMEPAD_B,
  GAMEPAD_BACK,
  GAMEPAD_DPAD_DOWN,
  GAMEPAD_DPAD_LEFT,
  GAMEPAD_DPAD_RIGHT,
  GAMEPAD_DPAD_UP,
  GAMEPAD_GUIDE,
  GAMEPAD_LB,
  GAMEPAD_RB,
  GAMEPAD_START,
  GAMEPAD_X,
  GAMEPAD_Y,
} from "../platforms/gfn/inputProtocol";
import type { VirtualGamepadFrame } from "../platforms/gfn/webrtcClient";

const DPAD_BITS = {
  up: GAMEPAD_DPAD_UP,
  down: GAMEPAD_DPAD_DOWN,
  left: GAMEPAD_DPAD_LEFT,
  right: GAMEPAD_DPAD_RIGHT,
} as const;

const STICK_DEADZONE = 0.12;

interface TouchGamepadProps {
  onFrame: (frame: VirtualGamepadFrame) => void;
  onRelease: () => void;
}

/**
 * On-screen gamepad for touch devices.
 *
 * Every control writes into a single mutable frame ref; a rAF loop forwards
 * it at display rate and the WebRTC client dedupes (send-on-change plus the
 * 100 ms controller keepalive), matching how physical pads are transported.
 * All visuals update through direct DOM writes (dataset/transform) so a drag
 * never triggers a React re-render.
 */
export function TouchGamepad({ onFrame, onRelease }: TouchGamepadProps): JSX.Element {
  const frameRef = useRef({
    buttons: 0,
    leftTrigger: 0,
    rightTrigger: 0,
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
  });
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;

  const leftStickPointer = useRef<number | null>(null);
  const rightStickPointer = useRef<number | null>(null);
  const dpadPointer = useRef<number | null>(null);
  const leftKnobRef = useRef<HTMLDivElement | null>(null);
  const rightKnobRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let rafId = 0;
    const tick = (): void => {
      onFrameRef.current({ ...frameRef.current });
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      onReleaseRef.current();
    };
  }, []);

  const sendNow = useCallback((): void => {
    onFrameRef.current({ ...frameRef.current });
  }, []);

  const pressButton = useCallback((bit: number, element: HTMLElement): void => {
    frameRef.current.buttons |= bit;
    element.dataset.active = "1";
    sendNow();
  }, [sendNow]);

  const releaseButton = useCallback((bit: number, element: HTMLElement): void => {
    frameRef.current.buttons &= ~bit;
    delete element.dataset.active;
    sendNow();
  }, [sendNow]);

  const buttonHandlers = useCallback((bit: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pressButton(bit, event.currentTarget);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>): void => {
      event.preventDefault();
      releaseButton(bit, event.currentTarget);
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>): void => {
      releaseButton(bit, event.currentTarget);
    },
  }), [pressButton, releaseButton]);

  const setTrigger = useCallback((side: "left" | "right", value: number, element: HTMLElement): void => {
    if (side === "left") frameRef.current.leftTrigger = value;
    else frameRef.current.rightTrigger = value;
    if (value > 0) element.dataset.active = "1";
    else delete element.dataset.active;
    sendNow();
  }, [sendNow]);

  const triggerHandlers = useCallback((side: "left" | "right") => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setTrigger(side, 1, event.currentTarget);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>): void => {
      event.preventDefault();
      setTrigger(side, 0, event.currentTarget);
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>): void => {
      setTrigger(side, 0, event.currentTarget);
    },
  }), [setTrigger]);

  const updateStick = useCallback((
    side: "left" | "right",
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let dx = (event.clientX - centerX) / (rect.width / 2);
    let dy = (event.clientY - centerY) / (rect.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    if (Math.hypot(dx, dy) < STICK_DEADZONE) {
      dx = 0;
      dy = 0;
    }
    // Keep the DOM convention here (y grows downward); the WebRTC client
    // inverts stick Y to the wire's XInput convention (up positive), the same
    // conversion readGamepadAxes applies to physical pads.
    if (side === "left") {
      frameRef.current.leftStickX = dx;
      frameRef.current.leftStickY = dy;
    } else {
      frameRef.current.rightStickX = dx;
      frameRef.current.rightStickY = dy;
    }
    const knob = side === "left" ? leftKnobRef.current : rightKnobRef.current;
    if (knob) {
      knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
    }
    sendNow();
  }, [sendNow]);

  const resetStick = useCallback((side: "left" | "right"): void => {
    if (side === "left") {
      frameRef.current.leftStickX = 0;
      frameRef.current.leftStickY = 0;
    } else {
      frameRef.current.rightStickX = 0;
      frameRef.current.rightStickY = 0;
    }
    const knob = side === "left" ? leftKnobRef.current : rightKnobRef.current;
    if (knob) knob.style.transform = "translate(0px, 0px)";
    sendNow();
  }, [sendNow]);

  const stickHandlers = useCallback((side: "left" | "right") => {
    const pointerRef = side === "left" ? leftStickPointer : rightStickPointer;
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerRef.current = event.pointerId;
        event.currentTarget.dataset.active = "1";
        updateStick(side, event);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>): void => {
        if (pointerRef.current !== event.pointerId) return;
        event.preventDefault();
        updateStick(side, event);
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>): void => {
        if (pointerRef.current !== event.pointerId) return;
        event.preventDefault();
        pointerRef.current = null;
        delete event.currentTarget.dataset.active;
        resetStick(side);
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>): void => {
        if (pointerRef.current !== event.pointerId) return;
        pointerRef.current = null;
        delete event.currentTarget.dataset.active;
        resetStick(side);
      },
      };
  }, [updateStick, resetStick]);

  const updateDpad = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    let bits = 0;
    if (Math.hypot(dx, dy) > rect.width * 0.16) {
      if (Math.abs(dx) > Math.abs(dy)) {
        bits = dx > 0 ? DPAD_BITS.right : DPAD_BITS.left;
      } else {
        bits = dy > 0 ? DPAD_BITS.down : DPAD_BITS.up;
      }
    }
    const previous = frameRef.current.buttons & (GAMEPAD_DPAD_UP | GAMEPAD_DPAD_DOWN | GAMEPAD_DPAD_LEFT | GAMEPAD_DPAD_RIGHT);
    frameRef.current.buttons = (frameRef.current.buttons & ~previous) | bits;
    if (bits !== previous) sendNow();
  }, [sendNow]);

  const dpadHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dpadPointer.current = event.pointerId;
      event.currentTarget.dataset.active = "1";
      updateDpad(event);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>): void => {
      if (dpadPointer.current !== event.pointerId) return;
      event.preventDefault();
      updateDpad(event);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>): void => {
      if (dpadPointer.current !== event.pointerId) return;
      event.preventDefault();
      dpadPointer.current = null;
      delete event.currentTarget.dataset.active;
      frameRef.current.buttons &= ~(GAMEPAD_DPAD_UP | GAMEPAD_DPAD_DOWN | GAMEPAD_DPAD_LEFT | GAMEPAD_DPAD_RIGHT);
      sendNow();
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>): void => {
      if (dpadPointer.current !== event.pointerId) return;
      dpadPointer.current = null;
      delete event.currentTarget.dataset.active;
      frameRef.current.buttons &= ~(GAMEPAD_DPAD_UP | GAMEPAD_DPAD_DOWN | GAMEPAD_DPAD_LEFT | GAMEPAD_DPAD_RIGHT);
      sendNow();
    },
  };

  return (
    <div className="touch-gamepad" aria-hidden="true" onContextMenu={(event) => event.preventDefault()}>
      <div className="tg-top-row">
        <div className="tg-bumper tg-bumper--left" {...buttonHandlers(GAMEPAD_LB)}>LB</div>
        <div className="tg-mini-row">
          <div className="tg-mini" {...buttonHandlers(GAMEPAD_BACK)}>⧉</div>
          <div className="tg-mini" {...buttonHandlers(GAMEPAD_GUIDE)}>◉</div>
          <div className="tg-mini" {...buttonHandlers(GAMEPAD_START)}>☰</div>
        </div>
        <div className="tg-bumper tg-bumper--right" {...buttonHandlers(GAMEPAD_RB)}>RB</div>
      </div>

      <div className="tg-trigger tg-trigger--left" {...triggerHandlers("left")}>LT</div>
      <div className="tg-trigger tg-trigger--right" {...triggerHandlers("right")}>RT</div>

      <div className="tg-cluster tg-cluster--left">
        <div className="tg-stick" {...stickHandlers("left")}>
          <div className="tg-knob" ref={leftKnobRef} />
        </div>
        <div className="tg-dpad" {...dpadHandlers}>
          <span className="tg-dpad-glyph">✛</span>
        </div>
      </div>

      <div className="tg-cluster tg-cluster--right">
        <div className="tg-face">
          <div className="tg-face-btn tg-face-btn--y" {...buttonHandlers(GAMEPAD_Y)}>Y</div>
          <div className="tg-face-btn tg-face-btn--x" {...buttonHandlers(GAMEPAD_X)}>X</div>
          <div className="tg-face-btn tg-face-btn--b" {...buttonHandlers(GAMEPAD_B)}>B</div>
          <div className="tg-face-btn tg-face-btn--a" {...buttonHandlers(GAMEPAD_A)}>A</div>
        </div>
        <div className="tg-stick" {...stickHandlers("right")}>
          <div className="tg-knob" ref={rightKnobRef} />
        </div>
      </div>
    </div>
  );
}
