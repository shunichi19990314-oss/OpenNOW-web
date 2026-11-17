import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { errorEnvelopeHandler } from "./errorEnvelope";
import { SessionError } from "./gfn/errorCodes";

/**
 * The launch screen used to decide "a session is already running" by pattern
 * matching the English sentence in `error`. That made the classification depend
 * on provider prose: GFN answers `DuplicateSessionDetected`, the check looked for
 * `DUPLICATE SESSION`, and the visitor got a generic "起動に失敗しました" with an
 * actionless screen and an "Unknown" code label.
 *
 * The error handler now ships the machine-readable name and the raw upstream
 * description, so the browser can classify without parsing prose. These tests
 * pin that contract against the real handler, and pin the existing rule that
 * CloudMatch protocol codes (69, 11, …) must never be passed to
 * `response.status()` — doing so throws a RangeError and turns a mapped error
 * into an opaque 500.
 */

function buildApp(): express.Express {
  const app = express();
  app.get("/session-limit", () => {
    throw SessionError.fromResponse(
      502,
      JSON.stringify({
        requestStatus: {
          statusCode: 11,
          statusDescription: "DuplicateSessionDetected",
        },
      }),
    );
  });
  app.get("/protocol-code", () => {
    // Not an HTTP status: exercising the guard that keeps it out of .status().
    throw Object.assign(new Error("Session in queue abandoned."), { statusCode: 69 });
  });
  app.get("/plain-boom", () => {
    throw new Error("Unexpected server error.");
  });
  app.get("/http-code", () => {
    throw Object.assign(new Error("Upstream refused the request."), { statusCode: 429 });
  });

  app.use(errorEnvelopeHandler);
  return app;
}

let server: Server | null = null;

async function start(): Promise<string> {
  const app = buildApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe("error envelope", () => {
  it("exposes the provider error name and raw description", async () => {
    const base = await start();
    const response = await fetch(`${base}/session-limit`);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(body.code).toBe("SessionLimitExceeded");
    expect(body.statusDescription).toBe("DuplicateSessionDetected");
    // The protocol status code must still be reported, but out of band.
    expect(body.upstreamCode).toBe(11);
    expect(body.status).toBeUndefined();
  });

  it("never passes a CloudMatch protocol code to response.status()", async () => {
    const base = await start();
    const response = await fetch(`${base}/protocol-code`);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(body.upstreamCode).toBe(69);
    expect(body.code).toBeUndefined();
    expect(body.error).toBe("Session in queue abandoned.");
  });

  it("keeps genuine HTTP statuses", async () => {
    const base = await start();
    const response = await fetch(`${base}/http-code`);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(429);
    expect(body.upstreamCode).toBeUndefined();
    expect(body.code).toBeUndefined();
  });

  it("omits the optional fields for an unclassified failure", async () => {
    const base = await start();
    const response = await fetch(`${base}/plain-boom`);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(Object.keys(body)).toEqual(["error"]);
  });
});
