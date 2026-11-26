import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsUpdatesSection } from "./SettingsUpdatesSection";

/**
 * The web client cannot install builds; the section must say so rather than
 * offer an "install" button that never works. Before the updater state loads
 * the check button is disabled, so a click cannot race the first request.
 */
describe("SettingsUpdatesSection", () => {
  const markup = renderToStaticMarkup(<SettingsUpdatesSection showAll />);

  it("explains that the web build is updated on the host", () => {
    expect(markup).toContain("アップデート");
    expect(markup).toContain("ブラウザ版はホスト側で更新されます。");
  });

  it("disables the manual check until the updater reports it is possible", () => {
    expect(markup).toMatch(/disabled=""/);
  });

  it("offers the release notes", () => {
    expect(markup).toContain("settings-export-logs-btn");
  });
});
