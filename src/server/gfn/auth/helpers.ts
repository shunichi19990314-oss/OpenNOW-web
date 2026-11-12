import { createHash } from "node:crypto";
import os from "node:os";

import type { AuthTokens } from "@shared/gfn";

import {
  buildNvidiaAuthHeaders,
  GFN_PLAY_ORIGIN,
  GFN_PLAY_REFERER,
} from "../clientHeaders";
import { CLIENT_ID, STEAM_DECK_CLIENT_ID, STEAM_DECK_USER_AGENT } from "./constants";

const MAX_TOKEN_LIFETIME_SECONDS = 366 * 24 * 3600;
const MAX_JWT_CHARS = 64 * 1024;

export function parseExpiresInSeconds(value: unknown): number | undefined {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > MAX_TOKEN_LIFETIME_SECONDS) {
    return undefined;
  }
  return numeric;
}

export function toExpiresAt(
  expiresInSeconds: unknown,
  defaultSeconds = 86400,
  now = Date.now(),
): number {
  const seconds = parseExpiresInSeconds(expiresInSeconds) ?? defaultSeconds;
  return now + seconds * 1000;
}

function parseJwtClaims(token: string | undefined): { exp?: unknown; iat?: unknown } | null {
  if (!token || token.length > MAX_JWT_CHARS) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as { exp?: unknown; iat?: unknown }) : null;
  } catch {
    return null;
  }
}

export function jwtExpiryMs(token: string | undefined): number | undefined {
  const claims = parseJwtClaims(token);
  const exp = typeof claims?.exp === "number" && Number.isFinite(claims.exp) && claims.exp > 0
    ? claims.exp
    : undefined;
  return exp !== undefined ? exp * 1000 : undefined;
}

/**
 * Derive an expiry deadline from a freshly received JWT, preferring its
 * relative `(exp - iat)` lifetime over raw wall-clock `exp` so modest clock
 * skew between NVIDIA and the host cannot prematurely invalidate a token.
 */
export function receivedJwtExpiryMs(token: string | undefined, now = Date.now()): number | undefined {
  const claims = parseJwtClaims(token);
  const exp = typeof claims?.exp === "number" && Number.isFinite(claims.exp) && claims.exp > 0
    ? claims.exp
    : undefined;
  if (exp === undefined) {
    return undefined;
  }
  const iat = typeof claims?.iat === "number" && Number.isFinite(claims.iat) && claims.iat > 0
    ? claims.iat
    : undefined;
  if (iat !== undefined && exp > iat) {
    const lifetimeSeconds = parseExpiresInSeconds(exp - iat);
    if (lifetimeSeconds !== undefined) {
      return now + lifetimeSeconds * 1000;
    }
  }
  return exp * 1000;
}

/**
 * Earliest expiry across the OAuth access token and (when present as a real
 * JWT) the GFN service `id_token`, since GFN endpoints prefer `idToken`.
 */
export function effectiveTokenExpiryMs(
  tokens: Pick<AuthTokens, "expiresAt" | "idToken" | "idTokenExpiresAt">,
): number | undefined {
  const accessExpiry = typeof tokens.expiresAt === "number" && Number.isFinite(tokens.expiresAt)
    ? tokens.expiresAt
    : undefined;
  const idExpiry = tokens.idToken
    ? (
      typeof tokens.idTokenExpiresAt === "number" && Number.isFinite(tokens.idTokenExpiresAt)
        ? tokens.idTokenExpiresAt
        : jwtExpiryMs(tokens.idToken)
    )
    : undefined;
  if (accessExpiry !== undefined && idExpiry !== undefined) {
    return Math.min(accessExpiry, idExpiry);
  }
  return accessExpiry ?? idExpiry;
}

export function isExpired(expiresAt: number | undefined, now = Date.now()): boolean {
  if (!expiresAt) {
    return true;
  }
  return expiresAt <= now;
}

export function isNearExpiry(expiresAt: number | undefined, windowMs: number, now = Date.now()): boolean {
  if (!expiresAt) {
    return true;
  }
  return expiresAt - now < windowMs;
}

export function generateDeviceId(): string {
  const host = os.hostname();
  const username = os.userInfo().username;
  return createHash("sha256").update(`${host}:${username}:opennow-stable`).digest("hex");
}

export function buildAuthHeadersForClient(
  authClientId = CLIENT_ID,
  options: {
    bearerToken?: string;
    accept?: string;
    contentType?: string;
    includeReferer?: boolean;
  } = {},
): Record<string, string> {
  if (authClientId !== STEAM_DECK_CLIENT_ID) {
    return buildNvidiaAuthHeaders(options);
  }

  const headers: Record<string, string> = {
    Accept: options.accept ?? "application/json, text/plain, */*",
    Origin: GFN_PLAY_ORIGIN,
    Referer: GFN_PLAY_REFERER,
    "User-Agent": STEAM_DECK_USER_AGENT,
  };

  if (options.bearerToken !== undefined) {
    headers.Authorization = `Bearer ${options.bearerToken}`;
  }
  if (options.contentType) {
    headers["Content-Type"] = options.contentType;
  }

  return headers;
}
