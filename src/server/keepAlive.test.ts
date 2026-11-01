import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveKeepAliveConfig, startKeepAlive } from "./keepAlive";

describe("resolveKeepAliveConfig", () => {
  it("stays off by default so Railway generates no self-traffic", () => {
    const config = resolveKeepAliveConfig({ OPENNOW_ORIGIN: "https://x.up.railway.app" });
    expect(config.enabled).toBe(false);
    expect(config.url).toBeNull();
  });

  it("enables via KEEP_ALIVE with OPENNOW_ORIGIN and strips trailing slashes", () => {
    const config = resolveKeepAliveConfig({
      KEEP_ALIVE: "true",
      OPENNOW_ORIGIN: "https://opennow-web.onrender.com/",
    });
    expect(config.enabled).toBe(true);
    expect(config.url).toBe("https://opennow-web.onrender.com/api/health");
    expect(config.intervalMs).toBe(10 * 60_000);
  });

  it("accepts an explicit KEEP_ALIVE_URL without the flag", () => {
    const config = resolveKeepAliveConfig({ KEEP_ALIVE_URL: "https://example.com/ping" });
    expect(config.enabled).toBe(true);
    expect(config.url).toBe("https://example.com/ping");
  });

  it("an explicit false flag disables even with a URL", () => {
    const config = resolveKeepAliveConfig({
      KEEP_ALIVE: "false",
      KEEP_ALIVE_URL: "https://example.com/ping",
    });
    expect(config.enabled).toBe(false);
    expect(config.url).toBeNull();
  });

  it("cannot enable without any URL source", () => {
    expect(resolveKeepAliveConfig({ KEEP_ALIVE: "true" }).enabled).toBe(false);
  });

  it("clamps the interval into the 5-30 minute band", () => {
    expect(resolveKeepAliveConfig({ KEEP_ALIVE: "1", OPENNOW_ORIGIN: "https://a.example", KEEP_ALIVE_INTERVAL_MINUTES: "1" }).intervalMs)
      .toBe(5 * 60_000);
    expect(resolveKeepAliveConfig({ KEEP_ALIVE: "1", OPENNOW_ORIGIN: "https://a.example", KEEP_ALIVE_INTERVAL_MINUTES: "999" }).intervalMs)
      .toBe(30 * 60_000);
    expect(resolveKeepAliveConfig({ KEEP_ALIVE: "1", OPENNOW_ORIGIN: "https://a.example", KEEP_ALIVE_INTERVAL_MINUTES: "7" }).intervalMs)
      .toBe(7 * 60_000);
    expect(resolveKeepAliveConfig({ KEEP_ALIVE: "1", OPENNOW_ORIGIN: "https://a.example", KEEP_ALIVE_INTERVAL_MINUTES: "garbage" }).intervalMs)
      .toBe(10 * 60_000);
  });
});

describe("startKeepAlive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings on the configured interval and stops when disposed", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    const stop = startKeepAlive(
      { enabled: true, url: "https://a.example/api/health", intervalMs: 60_000 },
      fakeFetch,
    );

    expect(calls).toHaveLength(0); // no immediate ping
    // advanceTimersByTimeAsync flushes microtasks between timers so the
    // in-flight guard resets like it does with real timers.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual(["https://a.example/api/health"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(3);

    stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(calls).toHaveLength(3);
  });

  it("does nothing when disabled", () => {
    const fakeFetch = vi.fn();
    const stop = startKeepAlive(
      { enabled: false, url: null, intervalMs: 60_000 },
      fakeFetch as unknown as typeof fetch,
    );
    vi.advanceTimersByTime(600_000);
    expect(fakeFetch).not.toHaveBeenCalled();
    stop();
  });
});
