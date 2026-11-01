import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";

import { registerApi } from "./api";
import { attachSignalingBridge } from "./signalingBridge";
import { cacheManager } from "./services/cacheManager";
import { resolveKeepAliveConfig, startKeepAlive } from "./keepAlive";
import { cookieSessionMiddleware } from "./sessionStore";

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT ?? 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use("/api", cookieSessionMiddleware);
app.use((request, response, next) => {
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "microphone=(self), fullscreen=(self), camera=()");
  if (process.env.NODE_ENV === "production") {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https: ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
  }
  if (request.path.startsWith("/api/")) response.setHeader("Cache-Control", "no-store");
  next();
});
app.use((request, _response, next) => {
  if (request.method !== "GET" && request.path.startsWith("/api/") && request.header("x-opennow-client") !== "web") {
    next(Object.assign(new Error("Invalid same-origin request."), { statusCode: 403 }));
    return;
  }
  next();
});

registerApi(app);
attachSignalingBridge(server);

if (process.env.NODE_ENV === "production") {
  const staticDir = resolve("dist");
  app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
  app.get("/{*path}", (_request, response) => response.sendFile(resolve(staticDir, "index.html")));
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const rawStatus = typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;
  // SessionError.statusCode carries the CloudMatch protocol code (e.g. 69 =
  // SessionInQueueAbandoned), NOT an HTTP status. Passing it to
  // response.status() throws a RangeError that destroys the response into an
  // opaque non-JSON 500, hiding the mapped human-readable error from the
  // visitor. Only genuine HTTP statuses pass through; upstream protocol codes
  // become 502 with the code exposed in the body.
  const isHttpStatus = rawStatus !== undefined
    && Number.isInteger(rawStatus)
    && rawStatus >= 400
    && rawStatus <= 599;
  const status = isHttpStatus ? (rawStatus as number) : 502;
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const upstreamCode = !isHttpStatus && rawStatus !== undefined ? rawStatus : undefined;
  if (status >= 500) console.error("[Server]", error);
  response.status(status).json(
    upstreamCode === undefined ? { error: message } : { error: message, upstreamCode },
  );
});

// Process-level safety net. A stray unhandled rejection would otherwise
// terminate Node (v22 default), killing the instance mid-request and showing
// visitors a non-JSON proxy 500. Log loudly and stay up; Render restarts are
// reserved for genuinely unrecoverable states.
process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled promise rejection (process kept alive):", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[Server] Uncaught exception (process kept alive):", error);
});

await cacheManager.initialize();
server.listen(port, () => {
  console.log(`OpenNOW Web is running at http://localhost:${port}`);
});

// Optional idle-sleep countermeasure for Render's free plan (KEEP_ALIVE=true).
startKeepAlive(resolveKeepAliveConfig());
