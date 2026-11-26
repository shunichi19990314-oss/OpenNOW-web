import { RefreshCw, Rocket } from "lucide-react";
import { useCallback, useEffect, useState, type JSX } from "react";

import type { AppUpdaterState } from "@shared/gfn";

import { useTranslation } from "../../../i18n";
import { getUpdaterBadgeLabel } from "../settingsFormatters";

export interface SettingsUpdatesSectionProps {
  showAll: boolean;
  /** Called when the user asks to see the release notes. */
  onOpenWhatsNew?: () => void;
}

/**
 * Updates section.
 *
 * The desktop build owns an updater (version row, channel picker, download and
 * restart). The web client is deployed from the host, so the honest equivalent
 * is the version the shell reports plus the release notes — not a disabled
 * "install" button that can never work.
 */
export function SettingsUpdatesSection({ showAll, onOpenWhatsNew }: SettingsUpdatesSectionProps): JSX.Element {
  const { t } = useTranslation();
  const [state, setState] = useState<AppUpdaterState | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.openNow.getUpdaterState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => { cancelled = true; };
  }, []);

  const handleCheck = useCallback(async (): Promise<void> => {
    setChecking(true);
    try {
      const next = await window.openNow.checkForUpdates();
      setState(next);
    } catch {
      // The status line keeps showing the last known state.
    } finally {
      setChecking(false);
    }
  }, []);

  const canCheck = state?.canCheck ?? false;
  const version = state?.currentDisplayVersion ?? state?.currentVersion ?? "-";

  return (
    <section className="settings-section">
      {showAll && <div className="settings-section-context">{t("settings.sections.updates")}</div>}
      <div className="settings-section-header">
        <Rocket size={18} />
        <h2>{t("settings.updates.title")}</h2>
      </div>
      <div className="settings-rows">
        <div className="settings-row">
          <label className="settings-label">
            {t("settings.updates.currentVersion", { version })}
            <span className="settings-hint">{t("settings.updates.webManagedHint")}</span>
          </label>
          <div className="settings-updater-actions">
            <span className="settings-hint">
              {t("settings.updates.statusLabel", { status: state ? getUpdaterBadgeLabel(state) : "-" })}
            </span>
            <button
              type="button"
              className="settings-export-logs-btn"
              disabled={!canCheck || checking}
              onClick={() => void handleCheck()}
              title={canCheck ? t("settings.updates.checkNow") : t("settings.updates.checkUnavailable")}
            >
              <RefreshCw size={16} />
              {t("settings.updates.checkNow")}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-label">
            {t("settings.about.whatsNew")}
            <span className="settings-hint">{t("settings.about.whatsNewHint")}</span>
          </label>
          <button type="button" className="settings-export-logs-btn" onClick={() => onOpenWhatsNew?.()}>
            {t("settings.about.whatsNew")}
          </button>
        </div>
      </div>
    </section>
  );
}
