import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for "the top of the details modal is overlapped".
 *
 * The modal is opened from inside `.main-content`. On the catalog pages that
 * element is `position: relative; z-index: 1`, i.e. it is its own stacking
 * context, and the app shell above it is a second one (`isolation: isolate` on
 * `.app-container`). A `position: fixed` + `z-index: 2300` backdrop rendered
 * inside `.main-content` is therefore still confined *below* the fixed header
 * (`z-index: 1000`, opaque), so the header painted over the top of the dialog.
 * The visible symptom was the hero art appearing to slide under the header.
 *
 * Rendering the overlay into `document.body` moves it to the root stacking
 * context, which is what every other overlay in this shell does. These
 * assertions pin that placement, since a static render cannot observe portals.
 */

const source = readFileSync(
  fileURLToPath(new URL("../components/GameDetailsModal.tsx", import.meta.url)),
  "utf8",
);
const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

describe("details modal stacking", () => {
  it("portals the overlay into the document body", () => {
    expect(source).toContain('from "react-dom"');
    expect(source).toContain("createPortal");
    expect(source).toMatch(/createPortal\(\s*dialog,\s*document\.body\s*\)/);
  });

  it("still renders the overlay when there is no document (SSR / tests)", () => {
    // Static rendering has no `document`, and returning the portal call
    // unconditionally would throw there.
    expect(source).toMatch(/typeof document === "undefined"/);
  });

  it("keeps the dialog content, not a wrapper, as the portalled root", () => {
    // A portal whose child is a fragment of empty nodes would drop the
    // backdrop; the backdrop must be the element handed to createPortal.
    expect(source).toContain('const dialog = (');
    expect(source).toMatch(/const dialog = \(\s*<div className="game-details-backdrop"/);
  });
});

describe("app shell stacking contexts that trap fixed overlays", () => {
  it("is the reason the portal is required: the shell isolates, main raises z-index", () => {
    const appContainer = /\.app-container \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(appContainer).toContain("isolation: isolate");

    const mainContent = /\.app-container--atmosphere > \.main-content \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(mainContent).toContain("z-index");
  });

  it("puts the navbar above any child stacking context of the page", () => {
    const navbar = /\.navbar \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const navbarZ = Number(/z-index:\s*(-?\d+)/.exec(navbar)?.[1] ?? 0);
    const mainZ = Number(/z-index:\s*(-?\d+)/.exec(
      /\.app-container--atmosphere > \.main-content \{([^}]*)\}/.exec(css)?.[1] ?? "",
    )?.[1] ?? 0);
    expect(navbarZ).toBeGreaterThan(mainZ);
  });
});
