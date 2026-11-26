import { Gamepad2, Monitor, Tv } from "lucide-react";
import type { JSX } from "react";

import type { Settings } from "@shared/gfn";

import { useTranslation } from "../../../i18n";

export interface SettingsConsoleSectionProps {
  settings: Settings;
  showAll: boolean;
  handleChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** True while the console shell is the active one. */
  consoleModeActive: boolean;
}

/**
 * Console mode section.
 *
 * The console shell used to be toggled from two unrelated places (Interface for
 * `controllerMode`, Stream for `launchInConsoleMode`), and the desktop build
 * keeps a dedicated Console mode page. Switching shells never restarts the
 * stream, so it is safe to offer mid-session.
 */
export function SettingsConsoleSection({
  settings,
  showAll,
  handleChange,
  consoleModeActive,
}: SettingsConsoleSectionProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <section className="settings-section">
      {showAll && <div className="settings-section-context">{t("settings.sections.console")}</div>}
      <div className="settings-section-header settings-section-header--with-copy">
        <Gamepad2 size={18} />
        <div>
          <h2>{t("settings.console.title")}</h2>
          <p className="settings-section-subtitle">{t("settings.console.description")}</p>
        </div>
      </div>
      <div className="settings-rows">
        <div className="settings-row">
          <label className="settings-label">
            {t("settings.console.shellMode")}
            <span className="settings-hint">{t("settings.console.switchHint")}</span>
          </label>
          <div className="settings-chip-row">
            <button
              type="button"
              className={`settings-chip ${consoleModeActive ? "" : "active"}`}
              aria-pressed={!consoleModeActive}
              onClick={() => handleChange("controllerMode", false)}
            >
              <Monitor size={14} />
              <span>{t("settings.console.shellDesktop")}</span>
            </button>
            <button
              type="button"
              className={`settings-chip ${consoleModeActive ? "active" : ""}`}
              aria-pressed={consoleModeActive}
              onClick={() => handleChange("controllerMode", true)}
            >
              <Tv size={14} />
              <span>{t("settings.console.shellConsole")}</span>
            </button>
          </div>
        </div>

        <div className="settings-row">
          <label className="settings-label">
            {t("settings.console.startInConsole")}
            <span className="settings-hint">{t("settings.console.startInConsoleHint")}</span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.launchInConsoleMode}
              onChange={(e) => handleChange("launchInConsoleMode", e.target.checked)}
            />
            <span className="settings-toggle-track" />
          </label>
        </div>
      </div>
    </section>
  );
}
