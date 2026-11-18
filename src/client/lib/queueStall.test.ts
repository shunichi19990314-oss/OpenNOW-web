import { describe, expect, it } from "vitest";

import type { SessionInfo } from "@shared/gfn";

import {
  QUEUE_STALL_FAIL_MS,
  QUEUE_STALL_WARN_MS,
  createQueueStallState,
  observeQueueProgress,
  queueProgressSignature,
} from "./queueStall";

/**
 * "キューで待機中..." stayed on screen far too long.
 *
 * The bug was not the wording and not a short timeout: the launch loop had no
 * upper bound at all, so a session the provider had dropped was
 * indistinguishable from a busy queue. These tests pin the replacement rule —
 * measure *change*, not duration — and the threshold behaviour around it.
 */

const T0 = 1_700_000_000_000;

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: "s1",
    status: 1,
    queuePosition: 30,
    ...overrides,
  } as SessionInfo;
}

describe("queueProgressSignature", () => {
  it("changes when the queue position moves", () => {
    const a = session({ queuePosition: 30 });
    const b = session({ queuePosition: 29 });
    expect(queueProgressSignature(a)).not.toBe(queueProgressSignature(b));
  });

  it("changes when the status or the seat-setup step moves", () => {
    expect(queueProgressSignature(session({ status: 1 })))
      .not.toBe(queueProgressSignature(session({ status: 2 })));
    expect(queueProgressSignature(session({ seatSetupStep: 1 })))
      .not.toBe(queueProgressSignature(session({ seatSetupStep: 2 })));
  });

  it("treats a missing field and a missing field as equal", () => {
    // A poll that omits queuePosition must not read as progress. GFN's zone
    // balancer rotates backends that disagree, so absence flickers.
    expect(queueProgressSignature(session({ queuePosition: undefined })))
      .toBe(queueProgressSignature(session({ queuePosition: undefined })));
  });
});

describe("observeQueueProgress", () => {
  it("reports progress while the position keeps advancing", () => {
    let state = createQueueStallState(session({ queuePosition: 30 }), T0);
    // Ten minutes of waiting, but moving: this must never be called a stall.
    for (let i = 1; i <= 20; i += 1) {
      const result = observeQueueProgress(
        state,
        session({ queuePosition: 30 - i }),
        T0 + i * 30_000,
        true,
      );
      state = result.state;
      expect(result.status).toBe("progressing");
    }
  });

  it("warns once at the warning threshold, then stays quiet", () => {
    let state = createQueueStallState(session(), T0);
    const warnAt = T0 + QUEUE_STALL_WARN_MS;

    const first = observeQueueProgress(state, session(), warnAt, true);
    expect(first.status).toBe("warning");
    state = first.state;

    // Repeat observations must not spam the console.
    const second = observeQueueProgress(state, session(), warnAt + 5_000, true);
    expect(second.status).toBe("progressing");
  });

  it("declares a stall only after the failure threshold", () => {
    const state = createQueueStallState(session(), T0);

    const justBefore = observeQueueProgress(state, session(), T0 + QUEUE_STALL_FAIL_MS - 1, true);
    expect(justBefore.status).not.toBe("stalled");

    const atLimit = observeQueueProgress(justBefore.state, session(), T0 + QUEUE_STALL_FAIL_MS, true);
    expect(atLimit.status).toBe("stalled");
  });

  it("resets the stall clock when a stalled queue finally moves", () => {
    let state = createQueueStallState(session({ queuePosition: 30 }), T0);
    const stalled = observeQueueProgress(state, session({ queuePosition: 30 }), T0 + QUEUE_STALL_FAIL_MS, true);
    expect(stalled.status).toBe("stalled");

    const moved = observeQueueProgress(stalled.state, session({ queuePosition: 29 }), T0 + QUEUE_STALL_FAIL_MS + 2_000, true);
    expect(moved.status).toBe("progressing");
    expect(moved.state.lastProgressAt).toBe(T0 + QUEUE_STALL_FAIL_MS + 2_000);
  });

  it("does not accumulate stall time while out of the queue", () => {
    // Leaving the queue for setup must not inherit the queue's frozen clock and
    // instantly look stalled if the session is re-queued.
    let state = createQueueStallState(session(), T0);
    for (let i = 1; i <= 20; i += 1) {
      const result = observeQueueProgress(
        state,
        session({ status: 2, queuePosition: undefined }),
        T0 + i * 30_000,
        false,
      );
      state = result.state;
      expect(result.status).toBe("progressing");
    }

    const requeued = observeQueueProgress(state, session(), T0 + 20 * 30_000, true);
    expect(requeued.status).toBe("progressing");
    expect(requeued.stalledMs).toBe(0);
  });

  it("never calls a five-minute queue with movement a stall", () => {
    // The regression this guards: any *duration* based limit would kill a slow
    // but healthy queue. Only a frozen one is a stall.
    let state = createQueueStallState(session({ queuePosition: 400 }), T0);
    for (let i = 1; i <= 60; i += 1) {
      const result = observeQueueProgress(
        state,
        session({ queuePosition: 400 - i }),
        T0 + i * 10_000,
        true,
      );
      state = result.state;
      expect(result.status).toBe("progressing");
    }
  });
});
