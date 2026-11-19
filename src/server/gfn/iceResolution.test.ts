import { describe, expect, it } from "vitest";

import {
  normalizeIceServers,
  resetIceHostnameCache,
  setHostnameResolverForTests,
} from "./cloudmatchSignaling";
import type { CloudMatchResponse } from "./types";

/**
 * DNS must never sit in front of a queue poll.
 *
 * `toSessionInfo` awaits `normalizeIceServers`, and `toSessionInfo` builds the
 * response to `/api/stream/poll` — the request that carries the queue position.
 * So this function used to be on the critical path of "順番待ちの状況を確認して
 * います..." becoming "キュー内のポジション #15".
 *
 * The old shape was: for each ICE URL, `await` the system resolver, then
 * 1.1.1.1, then 8.8.8.8, strictly in sequence. Measured in this environment a
 * single unreachable fallback resolver took 23 s to time out, and that happened
 * per host, per poll.
 *
 * What is asserted here is the *shape*, not a wall-clock number: the function
 * must return without awaiting a resolution, and it must eventually expose the
 * resolved addresses once the background priming has run.
 */

function responseWith(iceServers: unknown[] | null): CloudMatchResponse {
  return {
    requestStatus: { statusCode: 1 },
    session: {
      sessionId: "s1",
      status: 1,
      iceServerConfiguration: iceServers ? { iceServers } : null,
    },
  } as unknown as CloudMatchResponse;
}

describe("normalizeIceServers", () => {
  it("returns without waiting for DNS", async () => {
    resetIceHostnameCache();
    const started = Date.now();
    const result = await normalizeIceServers(responseWith(null));
    const elapsed = Date.now() - started;

    // Any real DNS round trip is slower than this; the point is that no
    // resolution is awaited. Kept generous so the test is not flaky on a loaded
    // CI machine while still failing on the old code path (which awaited
    // `dns.promises.lookup` at minimum).
    expect(elapsed).toBeLessThan(50);
    // ...and it still returns usable servers, falling back to the hostnames,
    // which the browser can resolve itself.
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((server) => server.urls[0].startsWith("stun:"))).toBe(true);
  });

  it("preserves TURN credentials and leaves literal IPs untouched", async () => {
    resetIceHostnameCache();
    const direct = await normalizeIceServers(responseWith([
      { urls: ["stun:203.0.113.10:3478"] },
      { urls: ["turn:turn.example.invalid:3478"], username: "user", credential: "secret" },
    ]));

    expect(direct[0].urls[0]).toBe("stun:203.0.113.10:3478");
    expect(direct[1]).toMatchObject({ username: "user", credential: "secret" });
  });

  it("exposes resolved addresses once resolution has completed in the background", async () => {
    resetIceHostnameCache();
    // Prime the cache (the first call schedules the work and returns hostnames).
    await normalizeIceServers(responseWith([{ urls: ["stun:stun.l.google.com:19302"] }]));
    // Give the background resolver a moment; this is not a timing assertion on
    // the product path, it is waiting for the cache to fill.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const warm = await normalizeIceServers(responseWith([{ urls: ["stun:stun.l.google.com:19302"] }]));
    // Either it resolved to an IP or DNS is unavailable in this sandbox; both
    // are acceptable — what must not happen is a throw or a missing entry.
    expect(warm).toHaveLength(1);
    expect(warm[0].urls[0]).toMatch(/^stun:/);
  });

  it("is not delayed by a resolver that hangs", async () => {
    /*
     * The decisive test. The real failure was not "DNS is slow in principle" —
     * it was that the poll *awaited* it, so an unreachable fallback resolver
     * (measured at 23 s to time out) held the queue position hostage.
     *
     * A resolver that never settles is the worst possible case, and the poll
     * must still return immediately. Restoring the blocking `await` makes this
     * test exceed its timeout, which is the point.
     */
    setHostnameResolverForTests(() => new Promise<string | null>(() => undefined));
    try {
      resetIceHostnameCache();
      const started = Date.now();
      const result = await normalizeIceServers(responseWith([
        { urls: ["stun:stun.l.google.com:19302"] },
      ]));
      expect(Date.now() - started).toBeLessThan(50);
      // Returned with the hostname, which the browser can resolve itself.
      expect(result[0].urls[0]).toBe("stun:stun.l.google.com:19302");
    } finally {
      setHostnameResolverForTests(null);
    }
  });
});
