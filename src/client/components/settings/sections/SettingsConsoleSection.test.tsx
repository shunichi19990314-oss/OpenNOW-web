import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WEB_DEFAULT_SETTINGS } from "../../../webDefaults";
import { SettingsConsoleSection } from "./SettingsConsoleSection";

/**
 * Console mode used to be two unrelated toggles (Interface and Stream). The
 * section now owns the shell switch, so these guard the pressed state and the
 * startup toggle.
 */
function render(overrides: Partial<Parameters<typeof SettingsConsoleSection>[0]> = {}): string {
  return renderToStaticMarkup(
    <SettingsConsoleSection
      settings={WEB_DEFAULT_SETTINGS}
      showAll
      handleChange={() => {}}
      consoleModeActive={false}
      {...overrides}
    />,
  );
}

describe("SettingsConsoleSection", () => {
  it("marks the desktop shell as active while console mode is off", () => {
    const markup = render();
    expect(markup).toContain("デスクトップ");
    expect(markup).toContain("コンソール");
    // Two chips, exactly one of them pressed.
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("marks the console shell as active when console mode is on", () => {
    const markup = render({ settings: { ...WEB_DEFAULT_SETTINGS, controllerMode: true } });
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("settings-chip active");
  });

  it("keeps the start-in-console toggle", () => {
    const markup = render({ settings: { ...WEB_DEFAULT_SETTINGS, launchInConsoleMode: true } });
    expect(markup).toContain("コンソールモードで起動");
    expect(markup).toMatch(/checked=""/);
  });
});
