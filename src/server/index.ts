import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";

import { registerApi } from "./api";
import { attachSignalingBridge } from "./signalingBridge";
import { cacheManager } from "./services/cacheManager";
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
  const status = typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : 500;
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  if (status >= 500) console.error("[Server]", error);
  response.status(status).json({ error: message });
});

await cacheManager.initialize();
server.listen(port, () => {
  console.log(`OpenNOW Web is running at http://localhost:${port}`);
});
