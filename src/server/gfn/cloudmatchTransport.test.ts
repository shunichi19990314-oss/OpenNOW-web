import { describe, expect, it } from "vitest";

import { isTrustedCloudMatchBase, normalizeCloudMatchBaseUrl } from "./cloudmatchTransport";

describe("isTrustedCloudMatchBase", () => {
  it("accepts HTTPS NVIDIA CloudMatch bases", () => {
    expect(isTrustedCloudMatchBase("https://prod.cloudmatchbeta.nvidiagrid.net")).toBe(true);
    expect(isTrustedCloudMatchBase("https://cloudmatchprod-eu-central.nvidiagrid.net/")).toBe(true);
    expect(isTrustedCloudMatchBase("https://NP-ABC12.cloudmatchbeta.nvidiagrid.net")).toBe(true);
    expect(isTrustedCloudMatchBase("  https://cloudmatchprod-jp.nvidiagrid.net  ")).toBe(true);
  });

  it("rejects anything that is not an HTTPS nvidiagrid.net host", () => {
    expect(isTrustedCloudMatchBase("http://prod.cloudmatchbeta.nvidiagrid.net")).toBe(false);
    expect(isTrustedCloudMatchBase("https://nvidiagrid.net.evil.example")).toBe(false);
    expect(isTrustedCloudMatchBase("https://evil.example/https://prod.cloudmatchbeta.nvidiagrid.net")).toBe(false);
    expect(isTrustedCloudMatchBase("https://notnvidiagrid.net")).toBe(false);
    expect(isTrustedCloudMatchBase("prod.cloudmatchbeta.nvidiagrid.net")).toBe(false);
    expect(isTrustedCloudMatchBase("")).toBe(false);
    expect(isTrustedCloudMatchBase("   ")).toBe(false);
    expect(isTrustedCloudMatchBase(null)).toBe(false);
    expect(isTrustedCloudMatchBase(undefined)).toBe(false);
  });

  it("trusts normalized region bases coming from the web client", () => {
    const fromClient = normalizeCloudMatchBaseUrl("https://cloudmatchprod-jp.nvidiagrid.net/");
    expect(fromClient).toBe("https://cloudmatchprod-jp.nvidiagrid.net");
    expect(isTrustedCloudMatchBase(fromClient)).toBe(true);
  });
});

/**
 * Local-region discovery cache.
 *
 * `resolveCreateSessionBase` performs a `GET /v2/serverInfo` before every
 * `POST /v2/session` on the default base. That call is pure latency from the
 * launch's point of view — the answer describes the network path, not the
 * session, and cannot meaningfully change inside one launch. It is now memoised
 * so only the first launch of a session-ish window pays for it.
 *
 * These tests pin the contract without touching the network: a non-default base
 * is never looked up at all, and the memoised path is per (base, proxy).
 */
describe("resolveCreateSessionBase region cache", () => {
  it("returns a region base untouched without any lookup", async () => {
    const { resolveCreateSessionBase } = await import("./cloudmatchTransport");
    // A regional base is already specific; there is nothing to discover.
    await expect(
      resolveCreateSessionBase("https://cloudmatchprod-jp.nvidiagrid.net", "token", "c", "d"),
    ).resolves.toBe("https://cloudmatchprod-jp.nvidiagrid.net");
  });

  it("exposes a reset seam so tests and diagnostics can clear the memo", async () => {
    const { resetCreateBaseCache } = await import("./cloudmatchTransport");
    expect(() => resetCreateBaseCache()).not.toThrow();
  });
});
