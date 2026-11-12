import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokens } from "@shared/gfn";

// The refresh path must be exercised without touching NVIDIA, so the token
// refresh module is replaced wholesale. vi.hoisted keeps the spies reachable
// from the hoisted vi.mock factory.
const mocks = vi.hoisted(() => ({
  refreshAuthTokens: vi.fn(),
  refreshWithClientToken: vi.fn(),
  requestClientToken: vi.fn(),
}));

vi.mock("./gfn/auth/tokenRefresh", () => ({
  refreshAuthTokens: mocks.refreshAuthTokens,
  refreshWithClientToken: mocks.refreshWithClientToken,
  requestClientToken: mocks.requestClientToken,
}));

import { WebAuthSession, webAuthInternals } from "./webAuth";

function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.sig`;
}

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

  it("ignores stale cancelDeviceLogin calls once authenticated", () => {
    const session = WebAuthSession.fromSnapshot({
      version: 1,
      auth: {
        provider: {
          idpId: "nvidiagrid",
          code: "NVIDIA",
          displayName: "NVIDIA",
          streamingServiceUrl: "https://prod.cloudmatchbeta.nvidiagrid.net/",
          priority: 0,
        },
        tokens: { accessToken: "access", expiresAt: Date.now() + 3_600_000 },
        user: { userId: "u1", displayName: "Player", membershipTier: "FREE" },
      },
      attempts: [["stale-attempt", {
        provider: {
          idpId: "nvidiagrid",
          code: "NVIDIA",
          displayName: "NVIDIA",
          streamingServiceUrl: "https://prod.cloudmatchbeta.nvidiagrid.net/",
          priority: 0,
        },
        deviceCode: "dc",
        expiresAt: Date.now() + 60_000,
      }]],
      activeSessionIds: [],
    });

    session.cancelDeviceLogin("stale-attempt");
    expect(session.isDirty()).toBe(false);
    expect(session.publicSession()?.user.userId).toBe("u1");
  });
});

describe("WebAuthSession.requireAuth token refresh & QR client_token renewal", () => {
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
    webAuthInternals.resetRefreshCaches();
    mocks.refreshAuthTokens.mockReset();
    mocks.refreshWithClientToken.mockReset();
    mocks.requestClientToken.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("renews QR sessions via client_token when no OAuth refresh_token was issued", async () => {
    const freshIdJwt = makeJwt({
      sub: "user-1",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mocks.refreshWithClientToken.mockResolvedValue({
      access_token: "access-from-client-token",
      id_token: freshIdJwt,
      expires_in: 3600,
    });

    const session = sessionWithTokens({
      accessToken: "access-expired",
      idToken: "id-old",
      expiresAt: Date.now() - 5_000,
      authClientId: "steam-deck-client",
      clientToken: "nvidia-client-token",
      clientTokenExpiresAt: Date.now() + 86_400_000,
    });

    const auth = await session.requireAuth();

    expect(mocks.refreshWithClientToken).toHaveBeenCalledWith(
      "nvidia-client-token",
      "user-1",
      "steam-deck-client",
    );
    expect(mocks.refreshAuthTokens).not.toHaveBeenCalled();
    expect(auth.tokens.accessToken).toBe("access-from-client-token");
    expect(auth.tokens.idToken).toBe(freshIdJwt);
    expect(auth.tokens.clientToken).toBe("nvidia-client-token");
    expect(session.isDirty()).toBe(true);
    expect(session.publicSession()).not.toBeNull();
  });

  it("falls back to refresh_token when client_token refresh fails", async () => {
    mocks.refreshWithClientToken.mockRejectedValue(new Error("Client-token refresh failed (400): invalid_grant"));
    mocks.refreshAuthTokens.mockResolvedValue({
      accessToken: "access-from-refresh-token",
      refreshToken: "refresh-rotated",
      expiresAt: Date.now() + 3_600_000,
      authClientId: "steam-deck-client",
    });

    const session = sessionWithTokens({
      accessToken: "access-expired",
      idToken: "id-preserved",
      refreshToken: "refresh-fallback",
      expiresAt: Date.now() - 1_000,
      authClientId: "steam-deck-client",
      clientToken: "expired-client-token",
      clientTokenExpiresAt: Date.now() + 60_000,
    });

    const auth = await session.requireAuth();

    expect(mocks.refreshWithClientToken).toHaveBeenCalledTimes(1);
    expect(mocks.refreshAuthTokens).toHaveBeenCalledWith("refresh-fallback", "steam-deck-client");
    expect(auth.tokens.accessToken).toBe("access-from-refresh-token");
    expect(auth.tokens.refreshToken).toBe("refresh-rotated");
    // Refresh responses that omit id_token must not clobber the existing idToken.
    expect(auth.tokens.idToken).toBe("id-preserved");
    expect(session.isDirty()).toBe(true);
  });

  it("refreshes when the id_token JWT is near expiry even if access_token expires later", async () => {
    const soonExpiringIdJwt = makeJwt({
      sub: "user-1",
      exp: Math.floor((Date.now() + 60_000) / 1000),
    });
    const renewedIdJwt = makeJwt({
      sub: "user-1",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mocks.refreshWithClientToken.mockResolvedValue({
      access_token: "access-renewed",
      id_token: renewedIdJwt,
      expires_in: 3600,
    });

    const session = sessionWithTokens({
      accessToken: "access-long-lived",
      idToken: soonExpiringIdJwt,
      expiresAt: Date.now() + 7_200_000,
      authClientId: "steam-deck-client",
      clientToken: "client-token-valid",
      clientTokenExpiresAt: Date.now() + 86_400_000,
    });

    const auth = await session.requireAuth();

    expect(mocks.refreshWithClientToken).toHaveBeenCalledTimes(1);
    expect(auth.tokens.idToken).toBe(renewedIdJwt);
  });

  it("proactively rotates client_token when its own expiry window approaches", async () => {
    const newClientExpiry = Date.now() + 86_400_000;
    mocks.requestClientToken.mockResolvedValue({
      token: "client-token-rotated",
      expiresAt: newClientExpiry,
      lifetimeMs: 86_400_000,
    });

    const session = sessionWithTokens({
      accessToken: "access-fresh",
      expiresAt: Date.now() + 3_600_000,
      authClientId: "steam-deck-client",
      clientToken: "client-token-expiring",
      clientTokenExpiresAt: Date.now() + 60_000, // inside 5-minute window
    });

    const auth = await session.requireAuth();

    expect(mocks.requestClientToken).toHaveBeenCalledWith("access-fresh", "steam-deck-client");
    expect(auth.tokens.clientToken).toBe("client-token-rotated");
    expect(auth.tokens.clientTokenExpiresAt).toBe(newClientExpiry);
    expect(session.isDirty()).toBe(true);
  });

  it("keeps serving with the current token when the refresh fails transiently before expiry", async () => {
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

  it("preserves the session cookie on a transient 503 after token expiry and recovers on retry", async () => {
    mocks.refreshAuthTokens.mockRejectedValueOnce(new Error("Token refresh failed (503): upstream"));
    const session = sessionWithTokens({
      accessToken: "access-expired",
      refreshToken: "refresh-already-expired",
      expiresAt: Date.now() - 1_000,
    });

    await expect(session.requireAuth()).rejects.toMatchObject({ statusCode: 503 });
    // Crucial: a momentary NVIDIA 503 must NOT wipe the persistent cookie.
    expect(session.publicSession()).not.toBeNull();
    expect(session.isDirty()).toBe(false);

    mocks.refreshAuthTokens.mockResolvedValueOnce({
      accessToken: "access-recovered",
      refreshToken: "refresh-already-expired",
      expiresAt: Date.now() + 3_600_000,
    });
    const recovered = await session.requireAuth();
    expect(recovered.tokens.accessToken).toBe("access-recovered");
    expect(session.isDirty()).toBe(true);
  });

  it("signs out with 401 when NVIDIA definitively revokes the refresh grant", async () => {
    mocks.refreshAuthTokens.mockRejectedValue(
      Object.assign(new Error("Token refresh failed (400): {\"error\":\"invalid_grant\"}"), {
        definitiveRevocation: true,
      }),
    );
    const session = sessionWithTokens({
      accessToken: "access-expired",
      refreshToken: "refresh-revoked",
      expiresAt: Date.now() - 1_000,
    });

    await expect(session.requireAuth()).rejects.toMatchObject({ statusCode: 401 });
    expect(session.publicSession()).toBeNull();
    expect(session.isDirty()).toBe(true);
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
      clientTokenExpiresAt: Date.now() + 86_400_000,
      clientTokenLifetimeMs: 86_400_000,
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
    expect(mocks.refreshWithClientToken).not.toHaveBeenCalled();
  });

  it("forwards the snapshot authClientId (or undefined) without a cast", async () => {
    mocks.refreshAuthTokens.mockResolvedValue({
      accessToken: "access-fresh",
      refreshToken: "refresh-rotated",
      expiresAt: Date.now() + 3_600_000,
    });

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

  it("keeps serving an unexpired token without a refresh credential, then requires re-sign-in once expired", async () => {
    const nearExpiryButValid = sessionWithTokens({
      accessToken: "access-still-valid",
      expiresAt: Date.now() + 60_000,
    });
    const auth = await nearExpiryButValid.requireAuth();
    expect(auth.tokens.accessToken).toBe("access-still-valid");
    expect(nearExpiryButValid.publicSession()).not.toBeNull();

    const trulyExpired = sessionWithTokens({
      accessToken: "access-expired",
      expiresAt: Date.now() - 1_000,
    });
    await expect(trulyExpired.requireAuth()).rejects.toMatchObject({ statusCode: 401 });
    expect(trulyExpired.publicSession()).toBeNull();
  });

  it("resolveBrowserSession refreshes expired tokens on /api/session boot and clears revoked sessions cleanly", async () => {
    mocks.refreshWithClientToken.mockResolvedValueOnce({
      access_token: "boot-renewed-access",
      expires_in: 3600,
    });
    const active = sessionWithTokens({
      accessToken: "boot-stale-access",
      expiresAt: Date.now() - 10_000,
      clientToken: "boot-client-token",
      clientTokenExpiresAt: Date.now() + 86_400_000,
    });

    const renewed = await active.resolveBrowserSession();
    expect(renewed.session?.user.userId).toBe("user-1");
    expect(renewed.refresh.outcome).toBe("refreshed");
    expect(active.isDirty()).toBe(true);

    webAuthInternals.resetRefreshCaches();
    mocks.refreshWithClientToken.mockRejectedValueOnce(
      Object.assign(new Error("invalid_grant"), { definitiveRevocation: true }),
    );
    const revoked = sessionWithTokens({
      accessToken: "boot-stale-access",
      expiresAt: Date.now() - 10_000,
      clientToken: "revoked-client-token",
      clientTokenExpiresAt: Date.now() + 86_400_000,
    });

    const cleared = await revoked.resolveBrowserSession();
    expect(cleared.session).toBeNull();
    expect(cleared.refresh.outcome).toBe("failed");
    expect(revoked.isDirty()).toBe(true);
  });
});
