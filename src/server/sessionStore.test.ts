import { describe, expect, it } from "vitest";

import type { AuthSession } from "@shared/gfn";
import type { Response } from "express";
import { cookieSessionInternals } from "./sessionStore";
import { WebAuthSession } from "./webAuth";
import type { WebAuthSessionSnapshot } from "./webAuth";

function snapshot(userId: string): WebAuthSessionSnapshot {
  const auth: AuthSession = {
    provider: {
      idpId: "nvidia",
      code: "NVIDIA",
      displayName: "NVIDIA",
      streamingServiceUrl: "https://example.invalid/",
      priority: 0,
    },
    user: {
      userId,
      displayName: `Player ${userId}`,
      membershipTier: "FREE",
    },
    tokens: {
      accessToken: `access-${userId}`,
      refreshToken: `refresh-${userId}`,
      expiresAt: Date.now() + 60_000,
    },
  };
  return { version: 1, auth, attempts: [], activeSessionIds: [`stream-${userId}`] };
}

describe("encrypted cookie sessions", () => {
  it("isolates profiles and stream ownership across many visitors", () => {
    const encrypted = Array.from({ length: 500 }, (_, index) =>
      cookieSessionInternals.encrypt(snapshot(`user-${index}`)),
    );
    expect(new Set(encrypted).size).toBe(500);

    for (let index = 0; index < encrypted.length; index += 1) {
      const restored = cookieSessionInternals.decrypt(encrypted[index]);
      expect(restored?.auth?.user.userId).toBe(`user-${index}`);
      expect(restored?.activeSessionIds).toEqual([`stream-user-${index}`]);
    }
  });

  it("rejects a modified cookie instead of accepting forged profile state", () => {
    const encrypted = cookieSessionInternals.encrypt(snapshot("alice"));
    // Flip a raw bit inside the GCM tag region. Character-level tampering on
    // the base64url text is unreliable: depending on the byte-length modulo 3,
    // the trailing character carries ignored bits, so swapping it for "A"/"B"
    // can decode to identical bytes and the test flakes (~6-25% of runs).
    const bytes = Buffer.from(encrypted, "base64url");
    bytes[20] ^= 0x01;
    expect(cookieSessionInternals.decrypt(bytes.toString("base64url"))).toBeNull();
  });

  it("uses a fresh nonce when encrypting identical profiles", () => {
    const state = snapshot("same-user");
    expect(cookieSessionInternals.encrypt(state)).not.toBe(cookieSessionInternals.encrypt(state));
  });
});

describe("sliding cookie expiry", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function fakeResponse(): {
    written: Array<{ name: string; value?: string; cleared?: boolean; maxAge?: number }>;
    response: Response;
  } {
    const written: Array<{ name: string; value?: string; cleared?: boolean; maxAge?: number }> = [];
    const response = {
      cookie: (name: string, value: string, options: { maxAge?: number }) => {
        written.push({ name, value, maxAge: options.maxAge });
      },
      clearCookie: (name: string) => {
        written.push({ name, cleared: true });
      },
    } as unknown as Response;
    return { written, response };
  }

  it("requests the longest lifetime browsers honour (~400 days)", () => {
    // Chrome, Firefox and Safari all clamp longer Max-Age values, so asking for
    // "forever" would silently become 400 days anyway.
    expect(cookieSessionInternals.COOKIE_MAX_AGE_MS).toBe(400 * DAY_MS);
    expect(cookieSessionInternals.COOKIE_RENEW_AFTER_MS).toBe(100 * DAY_MS);
  });

  it("re-writes an unchanged cookie once the window has aged, so the session never lapses", () => {
    const session = WebAuthSession.fromSnapshot({
      ...snapshot("sliding-user"),
      savedAt: Date.now() - 200 * DAY_MS,
    });
    expect(session.isDirty()).toBe(false);

    const { written, response } = fakeResponse();
    cookieSessionInternals.persist(response, session);

    const values = written.filter((entry) => entry.value !== undefined);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((entry) => entry.maxAge === 400 * DAY_MS)).toBe(true);
    // The re-stamped snapshot round-trips and carries a fresh savedAt.
    const restored = cookieSessionInternals.decrypt(values.map((entry) => entry.value).join(""));
    expect(restored?.auth?.user.userId).toBe("sliding-user");
    expect(Date.now() - (restored?.savedAt ?? 0)).toBeLessThan(60_000);
  });

  it("does not re-write a recently saved cookie on every response", () => {
    const session = WebAuthSession.fromSnapshot({
      ...snapshot("fresh-user"),
      savedAt: Date.now(),
    });
    const { written, response } = fakeResponse();
    cookieSessionInternals.persist(response, session);
    expect(written).toHaveLength(0);
  });

  it("upgrades a pre-savedAt cookie on the next write", () => {
    // Cookies written before sliding renewal carry no timestamp at all.
    const session = WebAuthSession.fromSnapshot(snapshot("legacy-user"));
    expect(session.needsCookieRenewal(cookieSessionInternals.COOKIE_RENEW_AFTER_MS)).toBe(true);

    const { written, response } = fakeResponse();
    cookieSessionInternals.persist(response, session);
    expect(written.filter((entry) => entry.value !== undefined).length).toBeGreaterThan(0);
  });

  it("never renews for an empty session", () => {
    // Writing an empty snapshot could clobber a valid cookie that failed to
    // decrypt on this particular request.
    const session = new WebAuthSession();
    expect(session.hasPersistedState()).toBe(false);
    expect(session.needsCookieRenewal(0)).toBe(false);
  });
});
