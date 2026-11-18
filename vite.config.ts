import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The app is served from a wildcard preview host in development (and from
  // Render in production). Vite's default host allowlist only accepts
  // localhost, so the preview origin was rejected with a 403 before any HTML
  // was sent. `true` accepts any host; the server still binds to 0.0.0.0.
  server: { host: true, allowedHosts: true },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@client": fileURLToPath(new URL("./src/client", import.meta.url)),
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
