import React from "react";
import ReactDOM from "react-dom/client";
import { initLogCapture } from "@shared/logger";
import { installBrowserBridge } from "./api";
import { App } from "./App";
import { MotionProvider } from "./components/MotionProvider";
import { initializeLocale } from "./i18n";
import "./styles.css";

installBrowserBridge();

// Initialize log capture for the browser renderer.
initLogCapture("renderer");
void initializeLocale();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionProvider>
      <App />
    </MotionProvider>
  </React.StrictMode>,
);
