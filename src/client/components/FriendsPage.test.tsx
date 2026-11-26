import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FriendsPage } from "./FriendsPage";

/**
 * The page is the web counterpart of the desktop Friends route, which is an
 * explicit "not available from the provider" screen rather than a fake list.
 * It must stay honest and stay Japanese.
 */
describe("FriendsPage", () => {
  const markup = renderToStaticMarkup(<FriendsPage />);

  it("says the provider offers no friends service instead of listing contacts", () => {
    expect(markup).toContain("フレンドは準備中です");
    expect(markup).toContain("近日公開");
    expect(markup).toContain("NVIDIA");
    // No invented contacts: there is no friend list markup at all.
    expect(markup).not.toContain("friends-list");
  });

  it("offers the local co-op slots that do work", () => {
    expect(markup).toContain("この画面で一緒にプレイ");
    expect(markup).toContain("friends-slot");
    // Player one's slot is always drawn, even with no pad plugged in.
    expect(markup).toContain("P1");
    expect(markup).toContain("未接続");
  });

  it("does not leak English UI copy", () => {
    expect(markup).not.toContain("COMING SOON");
    expect(markup).not.toContain("Waiting");
  });
});
