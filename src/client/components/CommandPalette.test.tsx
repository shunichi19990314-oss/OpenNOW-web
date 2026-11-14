import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { GameInfo } from "@shared/gfn";

import { CommandPalette } from "./CommandPalette";
import { ContinuePlayingRail } from "./ContinuePlayingRail";
import { summarizeRecentActivity } from "../lib/localPreferences";

/**
 * Render-level guards for the two new catalog surfaces.
 *
 * Neither component is reachable without a signed-in NVIDIA account, so a
 * static render is the only automated proof that their props, translation keys
 * and list shapes stay wired. Effects (focus, animation) do not run here.
 */

function game(id: string, title: string): GameInfo {
  return {
    id,
    title,
    selectedVariantIndex: 0,
    variants: [],
    imageUrl: `https://example.invalid/${id}.jpg`,
  };
}

const context = {
  games: [game("1", "Cyberpunk 2077"), game("2", "Portal 2")],
  playtime: {},
  favoriteIds: ["2"],
  canStream: true,
  isStreaming: true,
  pages: ["home", "library", "settings"] as const,
};

describe("CommandPalette", () => {
  it("renders nothing while closed", () => {
    const markup = renderToStaticMarkup(
      <CommandPalette open={false} onClose={() => {}} context={context} onRun={() => {}} />,
    );
    expect(markup).toBe("");
  });

  it("renders games, navigation and stream commands while open", () => {
    const markup = renderToStaticMarkup(
      <CommandPalette open onClose={() => {}} context={context} onRun={() => {}} />,
    );
    expect(markup).toContain("command-palette-panel");
    expect(markup).toContain("Cyberpunk 2077");
    expect(markup).toContain("Portal 2");
    expect(markup).toContain("command-palette-item");
    expect(markup).toContain("data-palette-active=\"true\"");
    // Favorited games are listed before the rest.
    expect(markup.indexOf("Portal 2")).toBeLessThan(markup.indexOf("Cyberpunk 2077"));
  });

  it("does not offer stream commands when nothing is streaming", () => {
    const idle = renderToStaticMarkup(
      <CommandPalette
        open
        onClose={() => {}}
        context={{ ...context, canStream: false, isStreaming: false }}
        onRun={() => {}}
      />,
    );
    expect(idle).not.toContain("stream:toggleStats");
    expect(idle).toContain("page:home");
  });
});

describe("ContinuePlayingRail", () => {
  const entries = summarizeRecentActivity(
    [
      { ...game("1", "Alpha"), lastPlayed: "2026-01-02T00:00:00.000Z" },
      game("2", "Beta"),
    ],
    { "2": { totalSeconds: 7200, lastPlayedAt: "2026-02-01T00:00:00.000Z", sessionCount: 3 } },
  );

  it("renders a tile per recent game with its playtime", () => {
    const markup = renderToStaticMarkup(
      <ContinuePlayingRail entries={entries} onPlay={() => {}} onDetails={() => {}} />,
    );
    expect(markup).toContain("home-continue-row");
    expect(markup).toContain("Beta");
    expect(markup).toContain("2 h");
    expect(markup).toContain("Alpha");
  });

  it("renders nothing without activity", () => {
    const markup = renderToStaticMarkup(
      <ContinuePlayingRail entries={[]} onPlay={() => {}} onDetails={() => {}} />,
    );
    expect(markup).toBe("");
  });

  it("honours the limit", () => {
    const many = summarizeRecentActivity(
      [game("1", "A"), game("2", "B"), game("3", "C")],
      {
        "1": { totalSeconds: 3600, lastPlayedAt: "2026-03-01T00:00:00.000Z", sessionCount: 1 },
        "2": { totalSeconds: 3600, lastPlayedAt: "2026-02-01T00:00:00.000Z", sessionCount: 1 },
        "3": { totalSeconds: 3600, lastPlayedAt: "2026-01-01T00:00:00.000Z", sessionCount: 1 },
      },
    );
    const markup = renderToStaticMarkup(
      <ContinuePlayingRail entries={many} onPlay={() => {}} onDetails={() => {}} limit={2} />,
    );
    expect(markup).toContain("home-continue-tile\"");
    expect(markup.match(/class="home-continue-tile"/g)).toHaveLength(2);
  });
});
