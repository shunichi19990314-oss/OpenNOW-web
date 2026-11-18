import type { SessionInfo } from "@shared/gfn";

/**
 * Queue stall detection.
 *
 * The queue screen used to wait forever. Any session that kept reporting
 * "queued" counted as progress, so a session the provider had silently dropped
 * looked exactly like a busy queue: a spinner, a rising elapsed timer, and the
 * text "キューで待機中..." that never changed. Users reported it as an
 * excessively long queue wait, but the real defect was that the loop had no
 * concept of *stalling* — only of being finished or not.
 *
 * The signal is deliberately not "long". Queues are legitimately long, and a
 * real queue always advances. So the thing measured is **change**: if the three
 * values GFN actually reports (status, queue position, seat-setup step) stay
 * identical for long enough, nothing is happening and the launch is wedged.
 *
 * Extracted from App.tsx so the thresholds and the state machine can be tested
 * without mounting the whole application.
 */

/** Warn (console only) once the queue has been frozen this long. */
export const QUEUE_STALL_WARN_MS = 90 * 1000;

/**
 * Give up once the queue has been frozen this long.
 *
 * Five minutes of *zero* reported change. Chosen so that a genuinely long queue
 * is never killed — a real queue moves the position, even slowly — while a
 * stuck seat-setup step surfaces while the user is still watching the screen
 * rather than after an unbounded wait.
 */
export const QUEUE_STALL_FAIL_MS = 5 * 60 * 1000;

/**
 * The values that constitute progress.
 *
 * `undefined` is normalised to "" so that missing and missing compare equal: a
 * poll that omits a field must not be read as movement. This matters because
 * GFN's zone balancer answers polls from rotating backends that disagree with
 * each other, and a field flickering between a value and absent is not the
 * queue advancing.
 */
export function queueProgressSignature(session: SessionInfo): string {
  return [
    session.status,
    session.queuePosition ?? "",
    session.seatSetupStep ?? "",
  ].join("|");
}

export type QueueStallStatus = "progressing" | "warning" | "stalled";

export interface QueueStallState {
  /** Signature of the last observed change. */
  signature: string;
  /** When the last change was observed (ms epoch). */
  lastProgressAt: number;
  /** Whether the warning has already been logged for this stall. */
  warned: boolean;
}

export function createQueueStallState(session: SessionInfo, now: number): QueueStallState {
  return {
    signature: queueProgressSignature(session),
    lastProgressAt: now,
    warned: false,
  };
}

/**
 * Fold an observation into the state.
 *
 * Pure: returns the next state plus the verdict, so the caller decides what to
 * do (log, throw, continue) and tests can drive any clock they like.
 */
export function observeQueueProgress(
  state: QueueStallState,
  session: SessionInfo,
  now: number,
  inQueue: boolean,
): { state: QueueStallState; status: QueueStallStatus; stalledMs: number } {
  const signature = queueProgressSignature(session);
  const changed = signature !== state.signature;
  const next: QueueStallState = changed
    ? { signature, lastProgressAt: now, warned: false }
    : { ...state };

  // Setup/connecting has its own progress and its own timeouts; stall timing is
  // about the queue only. Holding the clock steady here means leaving the queue
  // never *creates* a stall.
  if (!inQueue) {
    next.lastProgressAt = now;
    next.warned = false;
    return { state: next, status: "progressing", stalledMs: 0 };
  }

  const stalledMs = now - next.lastProgressAt;
  if (stalledMs >= QUEUE_STALL_FAIL_MS) {
    return { state: next, status: "stalled", stalledMs };
  }
  if (stalledMs >= QUEUE_STALL_WARN_MS) {
    const firstTime = !next.warned;
    next.warned = true;
    return { state: next, status: firstTime ? "warning" : "progressing", stalledMs };
  }
  return { state: next, status: "progressing", stalledMs };
}
