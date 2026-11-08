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
});
