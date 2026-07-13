import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
} from "node:zlib";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import onHeaders from "on-headers";

import { WebAuthSession, type WebAuthSessionSnapshot } from "./webAuth";

const COOKIE_PREFIX = "opennow_state_";
const COOKIE_PATH = "/api";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_CHUNK_SIZE = 3_500;
const MAX_COOKIE_CHUNKS = 4;
const COOKIE_VERSION = 1;

const configuredSecret = process.env.SESSION_SECRET?.trim();
if (process.env.NODE_ENV === "production" && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
}

// Development sessions intentionally expire whenever the server restarts.
const sessionSecret = configuredSecret || randomBytes(32).toString("base64url");
const encryptionKey = createHash("sha256").update(sessionSecret).digest();

function parseCookies(value: string | undefined): Record<string, string> {
  return Object.fromEntries((value ?? "").split(";").flatMap((item) => {
    const index = item.indexOf("=");
    if (index < 1) return [];
    const name = item.slice(0, index).trim();
    const rawValue = item.slice(index + 1).trim();
    try {
      return [[name, decodeURIComponent(rawValue)]];
    } catch {
      return [];
    }
  }));
}

function encryptedCookieValue(snapshot: WebAuthSessionSnapshot): string {
  const compressed = brotliCompressSync(Buffer.from(JSON.stringify(snapshot), "utf8"), {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: 4_096,
    },
  });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  cipher.setAAD(Buffer.from(`OpenNOW-Web:${COOKIE_VERSION}`));
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([COOKIE_VERSION]), nonce, authenticationTag, encrypted]).toString("base64url");
}

function decryptCookieValue(value: string): WebAuthSessionSnapshot | null {
  try {
    const payload = Buffer.from(value, "base64url");
    if (payload.length < 30 || payload[0] !== COOKIE_VERSION) return null;
    const nonce = payload.subarray(1, 13);
    const authenticationTag = payload.subarray(13, 29);
    const encrypted = payload.subarray(29);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, nonce);
    decipher.setAAD(Buffer.from(`OpenNOW-Web:${COOKIE_VERSION}`));
    decipher.setAuthTag(authenticationTag);
    const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed = JSON.parse(brotliDecompressSync(compressed).toString("utf8")) as WebAuthSessionSnapshot;
    if (parsed.version !== 1 || !Array.isArray(parsed.attempts) || !Array.isArray(parsed.activeSessionIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function joinedCookieValue(request: Pick<IncomingMessage, "headers">): string | null {
  const cookies = parseCookies(request.headers.cookie);
  const chunks: string[] = [];
  for (let index = 0; index < MAX_COOKIE_CHUNKS; index += 1) {
    const chunk = cookies[`${COOKIE_PREFIX}${index}`];
    if (!chunk) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks.join("") : null;
}

function loadCookieSession(request: Pick<IncomingMessage, "headers">): WebAuthSession {
  const encrypted = joinedCookieValue(request);
  const snapshot = encrypted ? decryptCookieValue(encrypted) : null;
  return snapshot ? WebAuthSession.fromSnapshot(snapshot) : new WebAuthSession();
}

function persistCookieSession(response: Response, session: WebAuthSession): void {
  if (!session.isDirty()) return;
  const encrypted = encryptedCookieValue(session.toSnapshot());
  const chunks = encrypted.match(new RegExp(`.{1,${COOKIE_CHUNK_SIZE}}`, "g")) ?? [];
  if (chunks.length > MAX_COOKIE_CHUNKS) {
    throw new Error("Encrypted OpenNOW session exceeds the safe browser cookie limit.");
  }

  const options = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_MS,
    path: COOKIE_PATH,
  };
  for (let index = 0; index < MAX_COOKIE_CHUNKS; index += 1) {
    const name = `${COOKIE_PREFIX}${index}`;
    const chunk = chunks[index];
    if (chunk) response.cookie(name, chunk, options);
    else response.clearCookie(name, options);
  }
  session.markPersisted();
}

export const cookieSessionMiddleware: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
): void => {
  const session = loadCookieSession(request);
  response.locals.openNowSession = session;
  onHeaders(response, () => {
    persistCookieSession(response, session);
  });
  next();
};

export function getSession(_request: Request, response?: Response): WebAuthSession {
  const session = response?.locals.openNowSession as WebAuthSession | undefined;
  if (!session) throw new Error("Cookie session middleware is not initialized.");
  return session;
}

export function getExistingSession(request: Pick<IncomingMessage, "headers">): WebAuthSession | null {
  const encrypted = joinedCookieValue(request);
  if (!encrypted) return null;
  const snapshot = decryptCookieValue(encrypted);
  return snapshot ? WebAuthSession.fromSnapshot(snapshot) : null;
}

export const cookieSessionInternals = {
  encrypt: encryptedCookieValue,
  decrypt: decryptCookieValue,
  load: loadCookieSession,
};
