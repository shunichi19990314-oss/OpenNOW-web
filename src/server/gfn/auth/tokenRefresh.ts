import type { AuthTokens } from "@shared/gfn";

import { CLIENT_ID, CLIENT_TOKEN_ENDPOINT, TOKEN_ENDPOINT } from "./constants";
import {
  buildAuthHeadersForClient,
  jwtExpiryMs,
  parseExpiresInSeconds,
  receivedJwtExpiryMs,
  toExpiresAt,
} from "./helpers";

const AUTH_FETCH_TIMEOUT_MS = 10_000;

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  client_token?: string;
  expires_in?: number;
}

interface ClientTokenResponse {
  client_token?: string;
  expires_in?: number;
}

export class TokenRefreshError extends Error {
  readonly httpStatus?: number;
  readonly oauthError?: string;
  readonly definitiveRevocation: boolean;

  constructor(message: string, options?: { httpStatus?: number; responseBody?: string }) {
    super(message);
    this.name = "TokenRefreshError";
    this.httpStatus = options?.httpStatus;

    const body = options?.responseBody ?? "";
    let oauthError: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed?.error === "string") {
        oauthError = parsed.error;
      }
    } catch {
      // Upstream body is not JSON; fall back to substring inspection below.
    }
    this.oauthError = oauthError;

    const status = options?.httpStatus;
    const isAuthRejectionStatus = status === 400 || status === 401 || status === 403;
    const normalized = `${oauthError ?? ""} ${body} ${message}`.toLowerCase();
    this.definitiveRevocation = Boolean(
      isAuthRejectionStatus && (
        normalized.includes("invalid_grant")
        || normalized.includes("invalid_token")
        || normalized.includes("token_revoked")
        || normalized.includes("unauthorized_client")
        || normalized.includes("revoked")
      ),
    );
  }
}

export async function refreshAuthTokens(
  refreshToken: string,
  authClientId = CLIENT_ID,
): Promise<AuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: authClientId,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: buildAuthHeadersForClient(authClientId, {
      contentType: "application/x-www-form-urlencoded; charset=UTF-8",
    }),
    body,
    signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new TokenRefreshError(
      `Token refresh failed (${response.status}): ${text.slice(0, 400)}`,
      { httpStatus: response.status, responseBody: text },
    );
  }

  const payload = (await response.json()) as TokenResponse;
  if (!payload.access_token) {
    throw new TokenRefreshError("Token refresh response did not include access_token");
  }

  const now = Date.now();
  const idTokenExpiresAt = receivedJwtExpiryMs(payload.id_token, now);
  const explicitSeconds = parseExpiresInSeconds(payload.expires_in);
  const expiresAt = explicitSeconds !== undefined
    ? now + explicitSeconds * 1000
    : (receivedJwtExpiryMs(payload.access_token, now) ?? idTokenExpiresAt ?? toExpiresAt(undefined, 86400, now));

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? refreshToken,
    idToken: payload.id_token,
    idTokenExpiresAt,
    expiresAt,
    authClientId,
    clientToken: payload.client_token,
  };
}

export async function requestClientToken(
  accessToken: string,
  authClientId = CLIENT_ID,
): Promise<{
  token: string;
  expiresAt: number;
  lifetimeMs: number;
}> {
  const response = await fetch(CLIENT_TOKEN_ENDPOINT, {
    headers: buildAuthHeadersForClient(authClientId, { bearerToken: accessToken }),
    signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new TokenRefreshError(
      `Client token request failed (${response.status}): ${text.slice(0, 400)}`,
      { httpStatus: response.status, responseBody: text },
    );
  }

  const payload = (await response.json()) as ClientTokenResponse;
  if (!payload.client_token) {
    throw new TokenRefreshError("Client token response did not include client_token");
  }

  const now = Date.now();
  const explicitSeconds = parseExpiresInSeconds(payload.expires_in);
  const expiresAt = explicitSeconds !== undefined
    ? now + explicitSeconds * 1000
    : (receivedJwtExpiryMs(payload.client_token, now) ?? toExpiresAt(undefined, 86400, now));
  return {
    token: payload.client_token,
    expiresAt,
    lifetimeMs: Math.max(0, expiresAt - now),
  };
}

export async function refreshWithClientToken(
  clientToken: string,
  userId: string,
  authClientId = CLIENT_ID,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:client_token",
    client_token: clientToken,
    client_id: authClientId,
    sub: userId,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: buildAuthHeadersForClient(authClientId, {
      contentType: "application/x-www-form-urlencoded; charset=UTF-8",
    }),
    body,
    signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new TokenRefreshError(
      `Client-token refresh failed (${response.status}): ${text.slice(0, 400)}`,
      { httpStatus: response.status, responseBody: text },
    );
  }

  const payload = (await response.json()) as TokenResponse;
  if (!payload.access_token) {
    throw new TokenRefreshError("Client-token refresh response did not include access_token");
  }
  return payload;
}

export function mergeTokenSnapshot(base: AuthTokens, refreshed: TokenResponse): AuthTokens {
  const now = Date.now();
  const nextIdToken = refreshed.id_token ?? base.idToken;
  const nextIdTokenExpiresAt = refreshed.id_token
    ? receivedJwtExpiryMs(refreshed.id_token, now)
    : (base.idTokenExpiresAt ?? jwtExpiryMs(base.idToken));
  const explicitSeconds = parseExpiresInSeconds(refreshed.expires_in);
  const expiresAt = explicitSeconds !== undefined
    ? now + explicitSeconds * 1000
    : (receivedJwtExpiryMs(refreshed.access_token, now) ?? nextIdTokenExpiresAt ?? toExpiresAt(undefined, 86400, now));
  const clientTokenRotated = Boolean(refreshed.client_token && refreshed.client_token !== base.clientToken);
  const rotatedClientExpiry = clientTokenRotated ? receivedJwtExpiryMs(refreshed.client_token, now) : undefined;

  return {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? base.refreshToken,
    idToken: nextIdToken,
    idTokenExpiresAt: nextIdTokenExpiresAt,
    expiresAt,
    authClientId: base.authClientId ?? CLIENT_ID,
    clientToken: refreshed.client_token ?? base.clientToken,
    clientTokenExpiresAt: clientTokenRotated ? rotatedClientExpiry : base.clientTokenExpiresAt,
    clientTokenLifetimeMs: clientTokenRotated
      ? (rotatedClientExpiry !== undefined ? Math.max(0, rotatedClientExpiry - now) : undefined)
      : base.clientTokenLifetimeMs,
  };
}
