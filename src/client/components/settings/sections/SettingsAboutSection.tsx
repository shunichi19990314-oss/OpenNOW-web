import { FileDown, Info, RotateCcw, Scale, Trash2 } from "lucide-react";
import { useState, type JSX } from "react";

import { useTranslation } from "../../../i18n";

export interface SettingsAboutSectionProps {
  showAll: boolean;
  onOpenWhatsNew?: () => void;
  /**
   * Restores every persisted preference. The parent re-applies the returned
   * settings so the UI reflects them without a reload.
   */
  onResetSettings?: () => Promise<boolean>;
  /** True while a stream is running: a reset would pull the rug from under it. */
  resetDisabled?: boolean;
}

export function SettingsAboutSection({
  showAll,
  onOpenWhatsNew,
  onResetSettings,
  resetDisabled = false,
}: SettingsAboutSectionProps): JSX.Element {
  const { t } = useTranslation();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<"done" | "failed" | null>(null);

  const handleReset = async (): Promise<void> => {
    if (!onResetSettings) return;
    setResetBusy(true);
    setResetMessage(null);
    try {
      const ok = await onResetSettings();
      setResetMessage(ok ? "done" : "failed");
      setConfirmReset(!ok);
    } catch {
      setResetMessage("failed");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <section className="settings-section">
      {showAll && <div className="settings-section-context">{t("settings.sections.about")}</div>}
      <div className="settings-section-header">
        <h2>{t("settings.sections.about")}</h2>
      </div>
      <div className="settings-rows">
        <div className="settings-row">
          <label className="settings-label">
            {t("settings.about.whatsNew")}
            <span className="settings-hint">{t("settings.about.whatsNewHint")}</span>
          </label>
          <button
            type="button"
            className="settings-export-logs-btn"
            onClick={() => onOpenWhatsNew?.()}
          >
            <Info size={16} />
            {t("settings.about.whatsNew")}
          </button>
        </div>

        <div className="settings-row">
          <label className="settings-label">
            {t("settings.about.exportLogs")}
            <span className="settings-hint">{t("settings.about.exportLogsHint")}</span>
          </label>
          <button
            type="button"
            className="settings-export-logs-btn"
            onClick={async () => {
              try {
                const logs = await window.openNow.exportLogs("text");
                const blob = new Blob([logs], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `opennow-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
                URL.revokeObjectURL(url);
              } catch (error) {
                console.error("[Settings] Failed to export logs:", error);
                alert(t("settings.about.exportLogsFailed"));
              }
            }}
          >
            <FileDown size={16} />
            {t("settings.about.exportLogs")}
          </button>
        </div>

        <div className="settings-row">
          <label className="settings-label">
            {t("settings.about.deleteCache")}
            <span className="settings-hint">{t("settings.about.deleteCacheHint")}</span>
          </label>
          <button
            type="button"
            className="settings-delete-cache-btn"
            onClick={async () => {
              if (!window.confirm(t("settings.about.deleteCacheConfirm"))) return;

              try {
                await window.openNow.deleteCache();
                alert(t("settings.about.cacheCleared"));
              } catch (error) {
                console.error("[Settings] Failed to delete cache:", error);
                alert(t("settings.about.deleteCacheFailed"));
              }
            }}
          >
            <Trash2 size={16} />
            {t("settings.about.deleteCache")}
          </button>
        </div>

        <div className="settings-row">
          <label className="settings-label">
            {t("settings.about.resetSettings")}
            <span className="settings-hint">{t("settings.about.resetSettingsHint")}</span>
          </label>
          {confirmReset ? (
            <div className="settings-inline-confirm" role="group" aria-label={t("settings.about.resetSettings")}>
              <span className="settings-inline-confirm-text">{t("settings.about.resetSettingsConfirm")}</span>
              <button
                type="button"
                className="settings-delete-cache-btn"
                disabled={resetBusy}
                onClick={() => void handleReset()}
              >
                {t("settings.about.resetSettingsConfirmAction")}
              </button>
              <button
                type="button"
                className="settings-export-logs-btn"
                disabled={resetBusy}
                onClick={() => {
                  setConfirmReset(false);
                  setResetMessage(null);
                }}
              >
                {t("settings.about.resetSettingsCancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="settings-delete-cache-btn"
              disabled={resetDisabled || !onResetSettings}
              onClick={() => {
                setResetMessage(null);
                setConfirmReset(true);
              }}
            >
              <RotateCcw size={16} />
              {t("settings.about.resetSettings")}
            </button>
          )}
          {resetMessage && (
            <p className="settings-diagnostics-status" role="status">
              {t(
                resetMessage === "done"
                  ? "settings.about.resetSettingsDone"
                  : "settings.about.resetSettingsFailed",
              )}
            </p>
          )}
        </div>
      </div>

      <div className="settings-legal">
        <div className="settings-legal-title">
          <Scale size={14} />
          {t("settings.about.legalTitle")}
        </div>
        <p className="settings-legal-body">{t("settings.about.legalBody")}</p>
      </div>
    </section>
  );
}
