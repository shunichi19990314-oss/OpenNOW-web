import { describe, expect, it } from "vitest";

import type { AuthSession } from "@shared/gfn";
import { cookieSessionInternals } from "./sessionStore";
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
