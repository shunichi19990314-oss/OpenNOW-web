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
};
