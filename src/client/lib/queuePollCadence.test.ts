import { describe, expect, it } from "vitest";

import { resolveQueuePollIntervalMs } from "../App";

/**
 * Time-to-first-position.
 *
 * `createSession` often returns before GFN has assigned a queue position, so the
 * card shows "順番待ちの状況を確認しています..." until a poll brings one. The loop
 * used to settle straight into the 5 s ad-supported cadence, which meant the
 * visitor waited a full interval for information that was usually available on
 * the very next request.
 *
 * The first few polls now run at the standard 2 s cadence. This is bounded on
 * purpose: an unbounded fast cadence would hammer the provider for the whole
 * queue, and the queue itself can be many minutes long.
 */
describe("resolveQueuePollIntervalMs", () => {
  it("polls quickly at the start of a queue session", () => {
    for (const attempt of [1, 2, 3, 4]) {
      expect(resolveQueuePollIntervalMs({ attempt, adPolling: true })).toBe(2000);
    }
  });

  it("settles into the ad cadence after the startup window", () => {
    expect(resolveQueuePollIntervalMs({ attempt: 5, adPolling: true })).toBe(5000);
    expect(resolveQueuePollIntervalMs({ attempt: 40, adPolling: true })).toBe(5000);
  });

  it("keeps the standard cadence for non-ad sessions", () => {
    expect(resolveQueuePollIntervalMs({ attempt: 1, adPolling: false })).toBe(2000);
    expect(resolveQueuePollIntervalMs({ attempt: 40, adPolling: false })).toBe(2000);
  });
});
