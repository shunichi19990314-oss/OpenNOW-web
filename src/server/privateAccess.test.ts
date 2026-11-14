import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("private access authentication", () => {
  it("authorizes the configured Basic auth credentials", async () => {
    process.env.OPENNOW_ACCESS_USER = "owner";
    process.env.OPENNOW_ACCESS_PASSWORD = "test-password";
    const { isPrivateAccessAuthorized } = await import("./privateAccess");
    const request = {
      header: (name: string) => name === "authorization"
        ? `Basic ${Buffer.from("owner:test-password").toString("base64")}`
        : undefined,
    } as never;

    expect(isPrivateAccessAuthorized(request)).toBe(true);
  });

  it("rejects missing or incorrect credentials", async () => {
    process.env.OPENNOW_ACCESS_USER = "owner";
    process.env.OPENNOW_ACCESS_PASSWORD = "test-password";
    const { isPrivateAccessAuthorized } = await import("./privateAccess");
    const request = { header: () => "Basic bm90LW93bmVyOm5vdC10aGUtcGFzc3dvcmQ=" } as never;

    expect(isPrivateAccessAuthorized(request)).toBe(false);
  });

  it("leaves the service open when no password is configured", async () => {
    delete process.env.OPENNOW_ACCESS_PASSWORD;
    const { isPrivateAccessAuthorized } = await import("./privateAccess");
    const request = { header: () => undefined } as never;

    expect(isPrivateAccessAuthorized(request)).toBe(true);
  });

  it("only tags static assets for revalidation, never HTML or the API", async () => {
    const { isCacheablePrivatePath } = await import("./privateAccess");
    // Hashed build output and fonts are what the browser caches for an hour.
    expect(isCacheablePrivatePath("/assets/index-a1b2c3.js")).toBe(true);
    expect(isCacheablePrivatePath("/assets/inter-latin.woff2")).toBe(true);
    expect(isCacheablePrivatePath("/public/logo.png")).toBe(true);
    expect(isCacheablePrivatePath("/sw.js")).toBe(true);
    // The document and the API must keep their own no-store behaviour.
    expect(isCacheablePrivatePath("/")).toBe(false);
    expect(isCacheablePrivatePath("/library")).toBe(false);
    expect(isCacheablePrivatePath("/api/health")).toBe(false);
  });

  it("marks an authorized static asset as private and Authorization-dependent", async () => {
    process.env.OPENNOW_ACCESS_USER = "owner";
    process.env.OPENNOW_ACCESS_PASSWORD = "test-password";
    const { privateAccessMiddleware } = await import("./privateAccess");
    const headers: Record<string, string> = {};
    let forwarded = false;
    const response = {
      setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    } as never;
    const request = {
      path: "/assets/index-a1b2c3.js",
      header: (name: string) => name === "authorization"
        ? `Basic ${Buffer.from("owner:test-password").toString("base64")}`
        : undefined,
    } as never;

    privateAccessMiddleware(request, response, () => { forwarded = true; });

    expect(forwarded).toBe(true);
    expect(headers["cache-control"]).toBe("private, no-cache, must-revalidate");
    expect(headers["vary"]).toBe("Authorization");
  });

  it("does not tag assets when private access is disabled", async () => {
    delete process.env.OPENNOW_ACCESS_PASSWORD;
    const { privateAccessMiddleware } = await import("./privateAccess");
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    } as never;
    const request = { path: "/assets/index-a1b2c3.js", header: () => undefined } as never;

    privateAccessMiddleware(request, response, () => {});

    expect(headers["cache-control"]).toBeUndefined();
  });

  it("keeps the document out of the shared cache while private access is on", async () => {
    process.env.OPENNOW_ACCESS_USER = "owner";
    process.env.OPENNOW_ACCESS_PASSWORD = "test-password";
    const { privateAccessMiddleware } = await import("./privateAccess");
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    } as never;
    const request = {
      path: "/library",
      header: () => `Basic ${Buffer.from("owner:test-password").toString("base64")}`,
    } as never;

    privateAccessMiddleware(request, response, () => {});

    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers["vary"]).toBe("Authorization");
  });
});
