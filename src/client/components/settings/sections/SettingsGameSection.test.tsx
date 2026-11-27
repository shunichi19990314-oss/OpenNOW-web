import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SettingsGameSection } from "./SettingsGameSection";

import type { Settings } from "@shared/gfn";

import ja from "../../../../../locales/ja.json";

/**
 * "Hide games you cannot play" is the only switch in Settings that changes what
 * the catalogue lists show, so it has to be discoverable: present in the Game
 * section, off by default, and wired to `hideUnplayableGames`.
 *
 * The row's label lives in a `.settings-row-top`; an earlier revision put it in
 * `.settings-row-top settings-row--compact`, which overrode the flex row and
 * collapsed the label/toggle pair, so the row read as plain text.
 */
function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    gameLanguage: "ja_JP",
    enablePersistingInGameSettings: false,
    hideUnplayableGames: false,
    ...overrides,
  } as Settings;
}

function render(target: Settings): string {
  return renderToStaticMarkup(
    <SettingsGameSection settings={target} showAll={false} handleChange={() => {}} />,
  );
}

describe("settings › game › hide unplayable games", () => {
  it("renders the switch with its Japanese label and hint", () => {
    const markup = render(settings());
    expect(markup).toContain(ja.settings.game.hideUnplayable);
    expect(markup).toContain(ja.settings.game.hideUnplayableHint);
    // The checkbox itself must be an unchecked toggle when the setting is off.
    expect(markup).toContain('type="checkbox"');
    expect(markup).not.toContain("checked=\"\"");
  });

  it("follows the stored value", () => {
    const markup = render(settings({ hideUnplayableGames: true }));
    expect(markup).toContain('checked=""');
  });

  it("explains what the switch does not touch when it is on", () => {
    const off = render(settings());
    expect(off).not.toContain(ja.settings.game.hideUnplayableNotes);

    const on = render(settings({ hideUnplayableGames: true }));
    expect(on).toContain("ライブラリ");
    expect(on).toContain("コマンドパレット");
  });

  it("marks the row when the settings search matches it", () => {
    const markup = renderToStaticMarkup(
      <SettingsGameSection
        settings={settings()}
        showAll
        handleChange={() => {}}
        highlightedSettingKeys={new Set(["settings.game.hideUnplayable"])}
      />,
    );
    expect(markup).toContain("settings-row--matched");
  });

  it("sits directly under the language row, before the settings-persistence switch", () => {
    // Discoverability: the answer to "cannot hide games" was partly that the
    // switch sat at the bottom of a long section.
    const markup = render(settings());
    const language = markup.indexOf(ja.settings.game.language);
    const hide = markup.indexOf(ja.settings.game.hideUnplayable);
    const persist = markup.indexOf(ja.settings.game.persistInGameSettings);
    expect(language).toBeGreaterThanOrEqual(0);
    expect(hide).toBeGreaterThan(language);
    expect(persist).toBeGreaterThan(hide);
  });

  it("keeps the label and the toggle in one flex row", () => {
    const markup = render(settings());
    const row = markup.slice(markup.indexOf(ja.settings.game.hideUnplayable) - 400, markup.indexOf(ja.settings.game.hideUnplayable));
    expect(row).toContain("settings-row-top");
    // `settings-row--compact` does not exist and silently broke the layout.
    expect(markup).not.toContain("settings-row--compact");
  });
});
