import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { StreamLoading } from "./StreamLoading";

/**
 * The queue card is the screen a visitor stares at while nothing else is
 * happening, so what it *says* is the feature.
 *
 * Reported as "the change from the first screen to the second is slow": the
 * card showed 計算中 with an empty position for ~30 s, then flipped to
 * "#15". Two separate causes were fixed — the pre-flight lookups no longer run
 * serially, and the poll loop no longer sleeps before its first request — but
 * the thing that made the wait feel broken was that the card had nothing to
 * say during it. These tests pin the three states it can be in.
 */

function render(overrides: Partial<Parameters<typeof StreamLoading>[0]> = {}): string {
  return renderToStaticMarkup(
    <StreamLoading
      gameTitle="崩壊：スターレイル"
      gameCover="/cover.png"
      status="queue"
      onCancel={() => undefined}
      {...overrides}
    />,
  );
}

describe("StreamLoading queue card", () => {
  it("states the position as soon as one exists", () => {
    const html = render({ queuePosition: 15 });
    expect(html).toContain("#15");
    // The position variant is what makes the number read as the headline.
    expect(html).toContain("sload-message--position");
  });

  it("explains an unknown position instead of leaving the cell blank", () => {
    const html = render({ queuePosition: undefined });
    // The empty telemetry cell is the thing that looked like a hang.
    expect(html).toContain("sload-queue-note");
  });

  it("does not show the explanation once the position is known", () => {
    const html = render({ queuePosition: 15 });
    expect(html).not.toContain("sload-queue-note");
  });

  it("does not claim to be queueing once the rig is being set up", () => {
    // A stale "queue" message over a setup stage is its own kind of wrong.
    const html = render({ status: "setup", queuePosition: undefined });
    expect(html).not.toContain("sload-queue-note");
  });

  it("keeps the position out of the error state", () => {
    const html = render({
      queuePosition: 15,
      error: { title: "起動に失敗しました", description: "もう一度お試しください。" },
    });
    expect(html).not.toContain("sload-queue-note");
    expect(html).not.toContain("sload-message--position");
  });
});
