import { FileDown, Info, Trash2 } from "lucide-react";
import type { JSX } from "react";

import { useTranslation } from "../../../i18n";

export interface SettingsAboutSectionProps {
  showAll: boolean;
  onOpenWhatsNew?: () => void;
}

export function SettingsAboutSection({ showAll, onOpenWhatsNew }: SettingsAboutSectionProps): JSX.Element {
  const { t } = useTranslation();

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
      </div>
    </section>
  );
}
