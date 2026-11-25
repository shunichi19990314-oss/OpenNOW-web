import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@client": fileURLToPath(new URL("./src/client", import.meta.url)),
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
  // The dev server is reverse-proxied behind a preview host. Vite's default
  // host check only accepts localhost names, so a proxied session got a 403
  // "Blocked request" page instead of the app.
  server: {
    host: "0.0.0.0",
    // The Express app owns the listening socket in dev (Vite runs in middleware
    // mode), so this is only read by `vite` when it started the server itself.
    // Host checks are disabled because the proxied preview host name is not
    // known ahead of time.
    allowedHosts: true,
  },
});
