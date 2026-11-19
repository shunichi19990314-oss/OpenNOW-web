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
