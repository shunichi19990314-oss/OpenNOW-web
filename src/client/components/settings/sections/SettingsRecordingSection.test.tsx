import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WEB_DEFAULT_SETTINGS } from "../../../webDefaults";
import { SettingsRecordingSection } from "./SettingsRecordingSection";

/**
 * Capture settings were split out of Stream (bitrate) and Controls
 * (shortcuts). This is a render guard that the section stays present, shows the
 * auto/custom choice and prints the bound keys.
 */
describe("SettingsRecordingSection", () => {
  const markup = renderToStaticMarkup(
    <SettingsRecordingSection
      settings={WEB_DEFAULT_SETTINGS}
      showAll
      handleChange={() => {}}
    />,
  );

  it("shows the recording bitrate with an auto option", () => {
    expect(markup).toContain("録画ビットレート");
    expect(markup).toContain("自動");
    expect(markup).toContain("settings-slider");
  });

  it("prints the configured screenshot and recording keys", () => {
    // Defaults are F11 / F12 in webDefaults; the row must reflect settings.
    expect(markup).toContain("F11");
    expect(markup).toContain("F12");
  });

  it("links to the captures page", () => {
    expect(markup).toContain("キャプチャ");
  });
});
