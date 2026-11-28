import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GameInfo } from "@shared/gfn";

import { ContinuePlayingRail } from "./ContinuePlayingRail";
import { SettingsBackupCard } from "./settings/sections/SettingsBackupCard";

import { WEB_DEFAULT_SETTINGS } from "../webDefaults";
import type { RecentActivityEntry } from "../lib/localPreferences";

import ja from "../../../locales/ja.json";

/**
 * The rail and the backup card are the two surfaces added for "more
 * convenience". Both must state what they will do *before* the click: which
 * server a resume will use, and what a restore is about to change.
 */

function game(id: string): GameInfo {
  return {
    id,
    title: `Game ${id}`,
    selectedVariantIndex: 0,
    variants: [{ id: `v-${id}`, store: "STEAM", supportedControls: [] }],
    imageUrl: `https://example.invalid/${id}.jpg`,
  };
}

const entry: RecentActivityEntry = {
  game: game("g1"),
  lastPlayedMs: Date.now(),
  totalSeconds: 3600,
  sessionCount: 3,
};

describe("continue rail launch route", () => {
  it("resumes on the saved server and says so", () => {
    const markup = renderToStaticMarkup(
      <ContinuePlayingRail
        entries={[entry]}
        onPlay={() => {}}
        onDetails={() => {}}
        onResumeRoute={() => {}}
        launchRoutes={{ g1: { streamingBaseUrl: "https://jp.example", lastLaunchedAtMs: 1 } }}
      />,
    );
    expect(markup).toContain("jp.example");
    expect(markup).toContain(ja.home.continuePlaying.resumeOnRoute);
  });

  it("falls back to the normal launch when there is no saved route", () => {
    const markup = renderToStaticMarkup(
      <ContinuePlayingRail entries={[entry]} onPlay={() => {}} onDetails={() => {}} />,
    );
    expect(markup).toContain(ja.home.continuePlaying.play);
    expect(markup).not.toContain(ja.home.continuePlaying.resumeOnRoute);
    expect(markup).not.toContain("home-continue-tile-route");
  });

  it("does not offer a resume when the app has no route handler", () => {
    const markup = renderToStaticMarkup(
      <ContinuePlayingRail
        entries={[entry]}
        onPlay={() => {}}
        onDetails={() => {}}
        launchRoutes={{ g1: { streamingBaseUrl: "https://jp.example", lastLaunchedAtMs: 1 } }}
      />,
    );
    // The chip still states the fact; the button stays a plain launch.
    expect(markup).toContain("jp.example");
    expect(markup).toContain(ja.home.continuePlaying.play);
    expect(markup).not.toContain(ja.home.continuePlaying.resumeOnRoute);
  });
});

describe("settings backup card", () => {
  it("explains that the file stays local and offers both actions", () => {
    const markup = renderToStaticMarkup(
      <SettingsBackupCard
        settings={{ ...WEB_DEFAULT_SETTINGS, fps: 120 }}
        defaults={WEB_DEFAULT_SETTINGS}
        onRestore={() => {}}
      />,
    );
    expect(markup).toContain(ja.settings.backup.title);
    expect(markup).toContain(ja.settings.backup.export);
    expect(markup).toContain(ja.settings.backup.restore);
    expect(markup).toContain(ja.settings.backup.description);
    // The confirmation only appears after a file is chosen.
    expect(markup).not.toContain(ja.settings.backup.confirmBody);
  });
});
