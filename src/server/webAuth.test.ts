import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokens } from "@shared/gfn";

// The refresh path must be exercised without touching NVIDIA, so the token
// refresh module is replaced wholesale. vi.hoisted keeps the spies reachable
// from the hoisted vi.mock factory.
const mocks = vi.hoisted(() => ({
  refreshAuthTokens: vi.fn(),
  requestClientToken: vi.fn(),
}));

vi.mock("./gfn/auth/tokenRefresh", () => ({
  refreshAuthTokens: mocks.refreshAuthTokens,
  requestClientToken: mocks.requestClientToken,
}));

import { WebAuthSession } from "./webAuth";

describe("WebAuthSession cookie hygiene", () => {
  it("starts clean so empty sessions never overwrite existing cookies", () => {
    // A request whose cookies failed to load must not write an empty snapshot
    // back over the browser's (possibly still valid) auth cookies.
    expect(new WebAuthSession().isDirty()).toBe(false);
  });

  it("restores from snapshot without marking dirty", () => {
    const session = WebAuthSession.fromSnapshot({
      version: 1,
      auth: null,
      attempts: [],
      activeSessionIds: ["stream-a"],
    });
    expect(session.isDirty()).toBe(false);
    expect(session.ownsActiveSession("stream-a")).toBe(true);
  });

  it("caps active session ids (FIFO) to bound cookie growth", () => {
    const session = new WebAuthSession();
    for (let index = 0; index < 25; index += 1) {
      session.addActiveSession(`stream-${index}`);
    }
    const snapshot = session.toSnapshot();
    expect(snapshot.activeSessionIds).toHaveLength(16);
    expect(snapshot.activeSessionIds[0]).toBe("stream-9");
    expect(snapshot.activeSessionIds[15]).toBe("stream-24");
    expect(session.isDirty()).toBe(true);
  });

  it("keeps newest ids when re-adding an already tracked id", () => {
    const session = new WebAuthSession();
    session.addActiveSession("stream-a");
    session.addActiveSession("stream-b");
    session.addActiveSession("stream-a"); // duplicate: no reorder, no growth
    expect(session.toSnapshot().activeSessionIds).toEqual(["stream-a", "stream-b"]);
  });

  it("reduceVolatileState keeps only the newest few ids", () => {
    const session = new WebAuthSession();
    for (let index = 0; index < 10; index += 1) {
      session.addActiveSession(`s-${index}`);
    }
    session.reduceVolatileState();
    expect(session.toSnapshot().activeSessionIds).toEqual(["s-6", "s-7", "s-8", "s-9"]);
  });
});

describe("WebAuthSession.requireAuth token refresh resilience", () => {
  const provider = {
    idpId: "nvidiagrid",
    code: "NVIDIA",
    displayName: "NVIDIA",
    streamingServiceUrl: "https://prod.cloudmatchbeta.nvidiagrid.net/",
    priority: 0,
  };
  const user = { userId: "user-1", displayName: "Tester", membershipTier: "free" };

  let warnSpy: ReturnType<typeof vi.spyOn>;

  function sessionWithTokens(tokens: Partial<AuthTokens> & { accessToken: string; expiresAt: number }): WebAuthSession {
    return WebAuthSession.fromSnapshot({
      version: 1,
      auth: { provider, tokens: tokens as AuthTokens, user },
      attempts: [],
      activeSessionIds: [],
    });
  }

  beforeEach(() => {
    mocks.refreshAuthTokens.mockReset();
    mocks.requestClientToken.mockReset();
    // The resilience fix warns on purpose; keep the assertion explicit and the
    // test output readable.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("keeps serving with the current token when the refresh fails transiently", async () => {
    // Still inside its validity window (near expiry, not expired): a dropped
    // call to NVIDIA's token endpoint must degrade to a warning, not a 502.
    mocks.refreshAuthTokens.mockRejectedValue(new Error("network unreachable"));
    const session = sessionWithTokens({
      accessToken: "access-current",
      refreshToken: "refresh-transient-failure",
      expiresAt: Date.now() + 60_000,
    });

    const auth = await session.requireAuth();

    expect(auth.tokens.accessToken).toBe("access-current");
    expect(session.isDirty()).toBe(false); // nothing changed, so no cookie rewrite
    expect(session.publicSession()).not.toBeNull(); // still signed in
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("continuing with the current token"),
      expect.any(Error),
    );
  });

  it("reports 401 (not a server error) when the refresh fails and the token is already expired", async () => {
    mocks.refreshAuthTokens.mockRejectedValue(new Error("Token refresh failed (503): upstream"));
    const session = sessionWithTokens({
      accessToken: "access-expired",
      refreshToken: "refresh-already-expired",
      expiresAt: Date.now() - 1_000,
    });

    await expect(session.requireAuth()).rejects.toMatchObject({ statusCode: 401 });
    expect(session.publicSession()).toBeNull(); // signed out so the client re-authenticates
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("requiring re-sign-in"),
      expect.any(Error),
    );
  });

  it("applies refreshed tokens and keeps the existing client token", async () => {
    mocks.refreshAuthTokens.mockResolvedValue({
      accessToken: "access-fresh",
      refreshToken: "refresh-rotated",
      idToken: "id-fresh",
      expiresAt: Date.now() + 3_600_000,
      authClientId: "client-1",
    });
    const session = sessionWithTokens({
      accessToken: "access-current",
      refreshToken: "refresh-success",
      expiresAt: Date.now() + 60_000,
      authClientId: "client-1",
      clientToken: "client-token-keep",
      clientTokenExpiresAt: 123,
      clientTokenLifetimeMs: 456,
    });

    const auth = await session.requireAuth();

    expect(auth.tokens.accessToken).toBe("access-fresh");
    expect(auth.tokens.refreshToken).toBe("refresh-rotated");
    expect(auth.tokens.clientToken).toBe("client-token-keep");
    expect(session.isDirty()).toBe(true);
  });

  it("does not contact NVIDIA while the token is still fresh", async () => {
    const session = sessionWithTokens({
      accessToken: "access-fresh",
      refreshToken: "refresh-untouched",
      expiresAt: Date.now() + 3_600_000,
    });

    const auth = await session.requireAuth();

    expect(auth.tokens.accessToken).toBe("access-fresh");
    expect(mocks.refreshAuthTokens).not.toHaveBeenCalled();
  });

  it("forwards the snapshot authClientId (or undefined) without a cast", async () => {
    mocks.refreshAuthTokens.mockResolvedValue({
      accessToken: "access-fresh",
      refreshToken: "refresh-rotated",
      expiresAt: Date.now() + 3_600_000,
    });

    // Older cookie snapshots predate authClientId: undefined must reach the
    // helper so its CLIENT_ID default applies.
    const legacy = sessionWithTokens({
      accessToken: "access-current",
      refreshToken: "refresh-legacy-snapshot",
      expiresAt: Date.now() + 60_000,
    });
    await legacy.requireAuth();
    expect(mocks.refreshAuthTokens).toHaveBeenLastCalledWith("refresh-legacy-snapshot", undefined);

    const modern = sessionWithTokens({
      accessToken: "access-current",
      refreshToken: "refresh-modern-snapshot",
      expiresAt: Date.now() + 60_000,
      authClientId: "client-42",
    });
    await modern.requireAuth();
    expect(mocks.refreshAuthTokens).toHaveBeenLastCalledWith("refresh-modern-snapshot", "client-42");
  });

  it("requires re-sign-in when a near-expiry token has no refresh token", async () => {
    const session = sessionWithTokens({
      accessToken: "access-current",
      expiresAt: Date.now() + 60_000,
    });

    await expect(session.requireAuth()).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.refreshAuthTokens).not.toHaveBeenCalled();
  });
});
