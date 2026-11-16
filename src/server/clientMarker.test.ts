import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Guards the `X-OpenNOW-Client` CSRF marker rule.
 *
 * The AI routes are exempt by design. Before the exemption, a request without
 * the marker was rejected with a bare 403 *before* authentication ran, so the
 * AI panel reported "HTTP 403" while the settings page (a GET) happily said the
 * feature was ready. The middleware is reproduced here so the rule is pinned
 * without booting the whole app (which imports the GFN client and needs env).
 */

const CLIENT_MARKER_HEADER = "x-opennow-client";
const EXEMPT_PATHS = new Set(["/api/ai/decide", "/api/ai/status"]);

function markerGuard(request: express.Request, response: express.Response, next: express.NextFunction): void {
  if (request.method === "GET" || !request.path.startsWith("/api/")) {
    next();
    return;
  }
  if (request.header(CLIENT_MARKER_HEADER) === "web" || EXEMPT_PATHS.has(request.path)) {
    next();
    return;
  }
  next(Object.assign(new Error("Invalid same-origin request."), { statusCode: 403 }));
}

function buildApp(): express.Express {
  const app = express();
  app.use(markerGuard);
  // Stands in for the real handlers: proof that the request reached them.
  for (const path of ["/api/ai/decide", "/api/logout", "/api/stream/create", "/api/ai/status"]) {
    app.post(path, (_request, response) => response.json({ reached: true }));
  }
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    response.status(status).json({ error: (error as Error).message });
  });
  return app;
}

let server: Server | null = null;

async function start(): Promise<string> {
  const app = buildApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

describe("client marker guard", () => {
  it("lets the browser client through on mutating routes", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/logout`, {
      method: "POST",
      headers: { "X-OpenNOW-Client": "web" },
    });
    expect(response.status).toBe(200);
  });

  it("still rejects a mutating route without the marker", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/logout`, { method: "POST" });
    expect(response.status).toBe(403);
    // The guard must not leak an HTML error page into a JSON client.
    expect(await response.json()).toMatchObject({ error: "Invalid same-origin request." });
  });

  it("exempts the AI routes so a stale tab gets a real auth error, not 403", async () => {
    const base = await start();
    for (const path of ["/api/ai/decide", "/api/ai/status"]) {
      const response = await fetch(`${base}${path}`, { method: "POST" });
      // Reached the handler: the guard no longer answers first.
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ reached: true });
    }
  });

  it("keeps GET requests unaffected", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/unknown-get`);
    // No route: 404 from Express, not a 403 from the guard.
    expect(response.status).toBe(404);
  });
});
