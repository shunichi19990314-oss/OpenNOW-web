import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AiPlayerPanel } from "./AiPlayerPanel";
import { SettingsAiSection } from "./settings/sections/SettingsAiSection";

/**
 * Render guards for the AI player surfaces.
 *
 * The panel only makes sense during a live stream and the settings section only
 * for a signed-in operator, so these are static renders: they prove the props,
 * translation keys and disabled states stay wired. Network effects do not run.
 */

const SINK = { send: () => true };

function renderPanel(props: Partial<Parameters<typeof AiPlayerPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    <AiPlayerPanel
      gameTitle="Test Game"
      sessionStartedAtMs={Date.now()}
      sink={SINK}
      actionNames={["a", "b"]}
      {...props}
    />,
  );
}

describe("AI player panel", () => {
  it("renders nothing unless a stream is live", () => {
    expect(renderPanel({ enabled: false })).toBe("");
    expect(renderPanel({ enabled: true })).toContain("ai-player");
  });

  it("offers a start control that is closed until the user opens it", () => {
    const markup = renderPanel();
    expect(markup).toContain("ai-player-toggle");
    // The body (and its start button) stays collapsed so it cannot be clicked
    // by accident while a game has the keyboard.
    expect(markup).not.toContain("ai-player-body");
  });

  it("is disabled without an input sink", () => {
    const markup = renderPanel({ sink: null });
    expect(markup).toContain("ai-player-toggle");
    expect(markup).not.toContain("ai-player-body");
  });
});

describe("AI player settings section", () => {
  it("shows the setup steps and never renders an input for the key", () => {
    const markup = renderToStaticMarkup(<SettingsAiSection showAll />);
    expect(markup).toContain("settings-ai-steps");
    expect(markup).toContain("numes.ai/dashboard/keys");
    expect(markup).toContain("NUMES_API_KEY");
    // A key input would invite pasting a secret into the page; it must not exist.
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("type=\"password\"");
  });
});
