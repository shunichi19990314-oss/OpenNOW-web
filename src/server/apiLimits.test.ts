import { describe, expect, it } from "vitest";

import { speedTestInternals } from "./api";

/**
 * `/api/speedtest` streams up to 24 MiB of metered egress per call. These are
 * the guard rails that keep a retry loop (or a script) from turning one visitor
 * into a bandwidth bill.
 */
describe("speed test cooldown", () => {
  it("allows the first call and rejects an immediate second one", () => {
    const { claimSpeedTestSlot, SPEED_TEST_MIN_INTERVAL_MS } = speedTestInternals;
    expect(claimSpeedTestSlot("user-a", 1_000)).toBeNull();

    const retryAfter = claimSpeedTestSlot("user-a", 1_000 + 200);
    expect(retryAfter).toBe(Math.ceil((SPEED_TEST_MIN_INTERVAL_MS - 200) / 1000));
  });

  it("allows a retry once the cooldown has elapsed", () => {
    const { claimSpeedTestSlot, SPEED_TEST_MIN_INTERVAL_MS } = speedTestInternals;
    expect(claimSpeedTestSlot("user-b", 5_000)).toBeNull();
    expect(claimSpeedTestSlot("user-b", 5_000 + SPEED_TEST_MIN_INTERVAL_MS)).toBeNull();
  });

  it("keeps visitors independent of each other", () => {
    const { claimSpeedTestSlot } = speedTestInternals;
    expect(claimSpeedTestSlot("user-c", 10_000)).toBeNull();
    expect(claimSpeedTestSlot("user-d", 10_000)).toBeNull();
  });

  it("bounds the tracked session map so it cannot grow without limit", () => {
    const { claimSpeedTestSlot } = speedTestInternals;
    for (let index = 0; index < 600; index += 1) {
      claimSpeedTestSlot(`burst-${index}`, 20_000 + index);
    }
    // Evicted entries start again from a clean slate rather than leaking memory.
    expect(claimSpeedTestSlot("burst-0", 30_000)).toBeNull();
  });
});
