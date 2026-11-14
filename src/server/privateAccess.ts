import { timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";

const ACCESS_USER = process.env.OPENNOW_ACCESS_USER?.trim() || "owner";
const ACCESS_PASSWORD = process.env.OPENNOW_ACCESS_PASSWORD ?? "";
const ACCESS_REALM = "OpenNOW Private";

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

function decodeBasicCredentials(request: Request): { user: string; password: string } | null {
  const header = request.header("authorization");
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

/** Attribute name used to tag responses the browser will cache behind Basic auth. */
export const PRIVATE_ACCESS_CACHE_BUST_HEADER = "X-OpenNOW-Private-Access";

/**
 * Basic-auth guarded paths that the browser will nevertheless cache on disk.
 *
 * Chromium's network cache is keyed by URL only — it does not include the
 * Authorization header in the cache key — so once one visitor's password has
 * unlocked `/` or a hashed asset, a later visitor on the same profile can be
 * served that response *without any credentials* being re-validated, even after
 * the operator changes OPENNOW_ACCESS_PASSWORD. Static assets are also
 * long-lived (`express.static maxAge: 1h`), which is what makes the stale entry
 * persist. HTML, service workers and API responses already opt out of caching.
 */
const CACHEABLE_PRIVATE_PATH_PATTERN = new RegExp(
  "^(?:/(?:assets|public)/.*|.*\\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|map))$",
);

export function isCacheablePrivatePath(path: string): boolean {
  return CACHEABLE_PRIVATE_PATH_PATTERN.test(path);
}

export function isPrivateAccessEnabled(): boolean {
  return ACCESS_PASSWORD.length > 0;
}

export function isPrivateAccessAuthorized(request: Request): boolean {
  if (!isPrivateAccessEnabled()) return true;
  const credentials = decodeBasicCredentials(request);
  return Boolean(
    credentials
    && safeEqual(credentials.user, ACCESS_USER)
    && safeEqual(credentials.password, ACCESS_PASSWORD),
  );
}

export const privateAccessMiddleware: RequestHandler = (request, response, next) => {
  // Render must be able to probe the service without credentials.
  if (request.path === "/api/health") {
    next();
    return;
  }
  if (isPrivateAccessAuthorized(request)) {
    // HTML, the service worker and /api responses are already no-store, but
    // hashed assets would otherwise stay in the browser cache after a password
    // change. Tag them so a revalidation is always required.
    if (isPrivateAccessEnabled()) {
      if (isCacheablePrivatePath(request.path)) {
        response.setHeader("Cache-Control", "private, no-cache, must-revalidate");
        response.setHeader("Vary", "Authorization");
        response.setHeader(PRIVATE_ACCESS_CACHE_BUST_HEADER, "1");
      } else if (!request.path.startsWith("/api/")) {
        // Documents behind Basic auth must never be reused from a profile cache
        // (browsers keep them across the credential prompt). `sendFile` would
        // otherwise emit `public, max-age=0`.
        response.setHeader("Cache-Control", "private, no-store");
        response.setHeader("Vary", "Authorization");
      }
    }
    next();
    return;
  }
  response.setHeader("WWW-Authenticate", `Basic realm="${ACCESS_REALM}", charset="UTF-8"`);
  response.setHeader("Cache-Control", "no-store");
  if (request.path.startsWith("/api/")) {
    response.status(401).json({ error: "Private access authentication required." });
    return;
  }
  response.status(401).type("text").send("OpenNOW is private. Please sign in with the authorized account.");
};

export const privateAccessInternals = {
  decodeBasicCredentials,
  safeEqual,
  ACCESS_USER,
  isCacheablePrivatePath,
};
