import React from "react";
import ReactDOM from "react-dom/client";
import { initLogCapture } from "@shared/logger";
import { installBrowserBridge } from "./api";
import { App } from "./App";
import { MotionProvider } from "./components/MotionProvider";
import { initializeLocale } from "./i18n";
import "./styles.css";
// The liquid-glass design system lives in its own stylesheet and is loaded after
// styles.css on purpose: it overrides the legacy surfaces rather than replacing
// them, so the parts of the old stylesheet that still do real work (layout,
// stream view, 3D scene) keep applying.
import "./design/liquidGlass.css";

installBrowserBridge();

// Initialize log capture for the browser renderer.
initLogCapture("renderer");
void initializeLocale();

// PWA: register the service worker in production builds only. It caches the
// app shell and hashed assets; /api/ and the signaling WebSocket are excluded.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("[PWA] Service worker registration failed:", error);
    });
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionProvider>
      <App />
    </MotionProvider>
  </React.StrictMode>,
);
