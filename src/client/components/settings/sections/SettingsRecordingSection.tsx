import { Film } from "lucide-react";
import type { JSX } from "react";

import type { Settings } from "@shared/gfn";

import { useTranslation } from "../../../i18n";
import { formatShortcutForDisplay } from "../../../shortcuts";

export interface SettingsRecordingSectionProps {
  settings: Settings;
  showAll: boolean;
  handleChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Opens the Captures page, where screenshots and clips are listed. */
  onOpenCaptures?: () => void;
}

/**
 * Recording section.
 *
 * Capture settings used to be scattered: the recording bitrate sat deep in the
 * Stream page's advanced rows and the screenshot/recording shortcuts lived under
 * Controls. The desktop build keeps a Recording page, so this gathers the
 * capture side in one place and leaves the shortcuts where they are bound.
 */
export function SettingsRecordingSection({
  settings,
  showAll,
  handleChange,
  onOpenCaptures,
}: SettingsRecordingSectionProps): JSX.Element {
  const { t } = useTranslation();
  // Shortcuts are formatted with ⌘ only on a Mac; the platform check keeps the
  // labels the same as the Controls section's.
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const recordingBitrate = settings.recordingBitrateMbps;

  return (
    <section className="settings-section">
      {showAll && <div className="settings-section-context">{t("settings.sections.recording")}</div>}
      <div className="settings-section-header settings-section-header--with-copy">
        <Film size={18} />
        <div>
          <h2>{t("settings.recording.title")}</h2>
          <p className="settings-section-subtitle">{t("settings.recording.description")}</p>
        </div>
      </div>
      <div className="settings-rows">
        <div className="settings-row settings-row--column">
          <div className="settings-row-top">
            <label className="settings-label">{t("settings.video.recordingBitrate")}</label>
            <span className="settings-value-badge">
              {recordingBitrate === null ? t("app.labels.auto") : `${recordingBitrate} Mbps`}
            </span>
          </div>
          <div className="settings-chip-row">
            <button
              type="button"
              className={`settings-chip ${recordingBitrate === null ? "active" : ""}`}
              onClick={() => handleChange("recordingBitrateMbps", null)}
            >
              <span>{t("app.labels.auto")}</span>
            </button>
            <button
              type="button"
              className={`settings-chip ${recordingBitrate !== null ? "active" : ""}`}
              onClick={() => handleChange("recordingBitrateMbps", recordingBitrate ?? 75)}
            >
              <span>{t("settings.video.customBitrate")}</span>
            </button>
          </div>
          <input
            type="range"
            className="settings-slider"
            min={5}
            max={200}
            step={5}
            value={recordingBitrate ?? 75}
            disabled={recordingBitrate === null}
            onChange={(e) => handleChange("recordingBitrateMbps", parseInt(e.target.value, 10))}
          />
          <span className="settings-subtle-hint">{t("settings.video.recordingBitrateHint")}</span>
        </div>

        <div className="settings-row">
          <label className="settings-label">
            {t("settings.recording.screenshotShortcut")}
            <span className="settings-hint">{t("settings.recording.screenshotShortcutHint")}</span>
          </label>
          <span className="settings-value-badge">
            {formatShortcutForDisplay(settings.shortcutScreenshot, isMac)}
          </span>
        </div>

        <div className="settings-row">
          <label className="settings-label">
            {t("settings.recording.recordingShortcut")}
            <span className="settings-hint">{t("settings.recording.recordingShortcutHint")}</span>
          </label>
          <span className="settings-value-badge">
            {formatShortcutForDisplay(settings.shortcutToggleRecording, isMac)}
          </span>
        </div>

        <div className="settings-row">
          <label className="settings-label">
            {t("settings.recording.openCaptures")}
            <span className="settings-hint">{t("settings.recording.openCapturesHint")}</span>
          </label>
          <button type="button" className="settings-export-logs-btn" onClick={() => onOpenCaptures?.()}>
            <Film size={16} />
            {t("navigation.captures")}
          </button>
        </div>
      </div>
    </section>
  );
}
