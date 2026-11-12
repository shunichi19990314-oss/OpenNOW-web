import { describe, expect, it } from "vitest";

import { effectiveTokenExpiryMs, parseExpiresInSeconds, receivedJwtExpiryMs } from "./helpers";
import { mergeTokenSnapshot, TokenRefreshError } from "./tokenRefresh";

function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("auth token helpers & TokenRefreshError", () => {
  it("parses numeric and string expires_in values within bounds", () => {
    expect(parseExpiresInSeconds(3600)).toBe(3600);
    expect(parseExpiresInSeconds("7200")).toBe(7200);
    expect(parseExpiresInSeconds(0)).toBeUndefined();
    expect(parseExpiresInSeconds(-10)).toBeUndefined();
    expect(parseExpiresInSeconds("invalid")).toBeUndefined();
  });

  it("derives relative JWT expiry from (exp - iat) to tolerate clock skew", () => {
    const now = 1_700_000_000_000;
    const skewedJwt = makeJwt({ iat: 1_000_000, exp: 1_003_600 });
    expect(receivedJwtExpiryMs(skewedJwt, now)).toBe(now + 3_600_000);
  });

  it("picks the earlier of access_token and id_token expiry", () => {
    const idJwt = makeJwt({ exp: 2_000 }); // 2_000_000 ms
    expect(
      effectiveTokenExpiryMs({
        expiresAt: 5_000_000,
        idToken: idJwt,
      }),
    ).toBe(2_000_000);
  });

  it("classifies definitive OAuth revocations separately from transient upstream errors", () => {
    const revoked = new TokenRefreshError("Client-token refresh failed (400)", {
      httpStatus: 400,
      responseBody: JSON.stringify({ error: "invalid_grant", error_description: "Token expired or revoked" }),
    });
    expect(revoked.definitiveRevocation).toBe(true);
    expect(revoked.oauthError).toBe("invalid_grant");

    const serverOutage = new TokenRefreshError("Token refresh failed (503)", {
      httpStatus: 503,
      responseBody: "Service Unavailable",
    });
    expect(serverOutage.definitiveRevocation).toBe(false);

    const rateLimited = new TokenRefreshError("Token refresh failed (429)", {
      httpStatus: 429,
      responseBody: JSON.stringify({ error: "slow_down" }),
    });
    expect(rateLimited.definitiveRevocation).toBe(false);
  });

  it("mergeTokenSnapshot preserves existing idToken and refreshToken when omitted", () => {
    const merged = mergeTokenSnapshot(
      {
        accessToken: "old-access",
        refreshToken: "keep-refresh",
        idToken: "keep-id",
        idTokenExpiresAt: 9_999_000,
        expiresAt: 1_000,
        authClientId: "steam-deck",
        clientToken: "keep-client",
        clientTokenExpiresAt: 50_000_000,
        clientTokenLifetimeMs: 50_000_000,
      },
      {
        access_token: "new-access",
        expires_in: 3600,
      },
    );

    expect(merged.accessToken).toBe("new-access");
    expect(merged.refreshToken).toBe("keep-refresh");
    expect(merged.idToken).toBe("keep-id");
    expect(merged.idTokenExpiresAt).toBe(9_999_000);
    expect(merged.clientToken).toBe("keep-client");
    expect(merged.clientTokenExpiresAt).toBe(50_000_000);
  });
});
