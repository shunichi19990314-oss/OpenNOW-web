import { HardDrive, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { Settings, SubscriptionInfo } from "@shared/gfn";
import { GFN_STORAGE_MANAGER_URL } from "@shared/gfn";
import { useTranslation } from "../../../i18n";
import { SelectDropdown } from "../../ui/SelectDropdown";
import { formatStorageGb } from "../settingsFormatters";
import type { StorageResetState } from "../settingsTypes";

export interface SettingsAccountSectionProps {
  settings: Settings;
  showAll: boolean;
  subscriptionInfo: SubscriptionInfo | null;
  subscriptionLoading: boolean;
}

export function SettingsAccountSection({
  settings,
  showAll,
  subscriptionInfo,
  subscriptionLoading,
}: SettingsAccountSectionProps): JSX.Element {
  const { t } = useTranslation();
  const [storageResetState, setStorageResetState] = useState<StorageResetState>("idle");
  const [storageResetMessage, setStorageResetMessage] = useState<string | null>(null);

  const persistentStorage = subscriptionInfo?.storageAddon;
  const persistentStorageSizeGb = typeof persistentStorage?.sizeGb === "number" ? persistentStorage.sizeGb : null;
  const persistentStorageUsedGb = typeof persistentStorage?.usedGb === "number" ? persistentStorage.usedGb : null;
  const persistentStorageRemainingGb =
    persistentStorageSizeGb !== null && persistentStorageUsedGb !== null
      ? Math.max(0, persistentStorageSizeGb - persistentStorageUsedGb)
      : null;
  const persistentStorageUsagePercent =
    persistentStorageSizeGb !== null && persistentStorageSizeGb > 0 && persistentStorageUsedGb !== null
      ? Math.max(0, Math.min(100, (persistentStorageUsedGb / persistentStorageSizeGb) * 100))
      : null;
  const persistentStorageSizeLabel = formatStorageGb(persistentStorage?.sizeGb);
  const persistentStorageUsedLabel = formatStorageGb(persistentStorage?.usedGb);
  const persistentStorageRemainingLabel = formatStorageGb(persistentStorageRemainingGb ?? undefined);
  const persistentStorageUsageLabel = persistentStorage
    ? persistentStorageUsedLabel && persistentStorageSizeLabel
      ? t("settings.persistentStorage.usage", {
        used: persistentStorageUsedLabel,
        total: persistentStorageSizeLabel,
      })
      : t("settings.persistentStorage.usageUnavailable")
    : subscriptionLoading
      ? t("app.status.loading")
      : t("settings.persistentStorage.notDetected");
  const persistentStorageRegionLabel =
    persistentStorage?.regionName ??
    persistentStorage?.regionCode ??
    (persistentStorage ? t("settings.persistentStorage.regionUnavailable") : null);
  const persistentStorageDetails = [
    persistentStorageRegionLabel
      ? t("settings.persistentStorage.region", { region: persistentStorageRegionLabel })
      : null,
    persistentStorageRemainingLabel
      ? t("settings.persistentStorage.remaining", { value: persistentStorageRemainingLabel })
      : null,
  ].filter((value): value is string => Boolean(value));
  const currentStorageLocationOptionLabel = persistentStorageRegionLabel
    ? t("settings.persistentStorage.currentLocationOption", { region: persistentStorageRegionLabel })
    : t("settings.persistentStorage.currentLocationUnavailable");
  const storageResetTargetLabel = persistentStorageRegionLabel ?? t("settings.persistentStorage.regionUnavailable");
  const storageResetTargetHint = t("settings.persistentStorage.resetRequiresBrowserHint", {
    region: storageResetTargetLabel,
  });

  const handleOpenPersistentStorageManager = useCallback(async (): Promise<void> => {
    try {
      await window.openNow.openExternalUrl(GFN_STORAGE_MANAGER_URL);
    } catch (error) {
      console.error("[Settings] Failed to open NVIDIA Storage Manager:", error);
      setStorageResetState("error");
      setStorageResetMessage(t("settings.persistentStorage.openManagerFailed"));
    }
  }, [t]);

  const handleResetPersistentStorage = useCallback(async (): Promise<void> => {
    if (!persistentStorage) {
      return;
    }

    setStorageResetState("idle");
    setStorageResetMessage(t("settings.persistentStorage.resetRequiresBrowser"));
    await handleOpenPersistentStorageManager();
  }, [handleOpenPersistentStorageManager, persistentStorage, t]);

  return (
    <section className="settings-section settings-storage-section">
      {showAll && <div className="settings-section-context">{t("settings.sections.account")}</div>}
      <div className="settings-section-header settings-section-header--with-copy">
        <HardDrive size={18} />
        <div>
          <h2>{t("settings.persistentStorage.title")}</h2>
          <p className="settings-section-subtitle">{t("settings.persistentStorage.description")}</p>
        </div>
      </div>
      <div className="settings-storage-card">
        <div className="settings-storage-summary">
          <div className="settings-storage-headline">
            <HardDrive size={18} />
            {persistentStorage ? (
              persistentStorageUsedLabel && persistentStorageSizeLabel ? (
                <span>
                  <strong>{persistentStorageUsedLabel}</strong>{" "}
                  {t("settings.persistentStorage.usedOutOf", { total: persistentStorageSizeLabel })}
                </span>
              ) : (
                <span>{t("settings.persistentStorage.usageUnavailable")}</span>
              )
            ) : (
              <span>{persistentStorageUsageLabel}</span>
            )}
          </div>
          {persistentStorage ? (
            <span className="settings-inline-badge settings-inline-badge--codec settings-inline-badge--codec-gpu">
              {t("settings.persistentStorage.detected")}
            </span>
          ) : null}
        </div>

        {persistentStorageUsagePercent !== null ? (
          <div
            className="settings-storage-meter"
            role="progressbar"
            aria-label={t("settings.persistentStorage.meterLabel")}
            aria-valuemin={0}
            aria-valuemax={persistentStorageSizeGb ?? 100}
            aria-valuenow={persistentStorageUsedGb ?? 0}
          >
            <div
              className="settings-storage-meter-used"
              style={{ width: `${persistentStorageUsagePercent}%` }}
            />
          </div>
        ) : (
          <div className="settings-storage-meter settings-storage-meter--empty" />
        )}

        <div className="settings-storage-legend">
          <span>
            <span className="settings-storage-legend-dot settings-storage-legend-dot--used" />
            {persistentStorageUsedLabel
              ? t("settings.persistentStorage.usedLegend", { value: persistentStorageUsedLabel })
              : t("settings.persistentStorage.usedLegendUnavailable")}
          </span>
          <span>
            <span className="settings-storage-legend-dot settings-storage-legend-dot--available" />
            {persistentStorageRemainingLabel
              ? t("settings.persistentStorage.availableLegend", { value: persistentStorageRemainingLabel })
              : t("settings.persistentStorage.availableLegendUnavailable")}
          </span>
        </div>

        <div className="settings-storage-location-control">
          <label className="settings-storage-location-copy" htmlFor="persistent-storage-reset-region">
            <span>{t("settings.persistentStorage.locationTitle")}</span>
            <span>{storageResetTargetHint}</span>
          </label>
          <SelectDropdown
            id="persistent-storage-reset-region"
            className="settings-storage-select-dropdown"
            value=""
            options={[{ value: "", label: currentStorageLocationOptionLabel }]}
            onChange={() => {}}
            disabled
            ariaLabel={t("settings.persistentStorage.locationTitle")}
          />
        </div>

        <div className="settings-storage-footer">
          <div className="settings-storage-meta">
            {persistentStorageDetails.length > 0 ? (
              <span>{persistentStorageDetails.join(" / ")}</span>
            ) : null}
            <span>{t("settings.persistentStorage.resetHint")}</span>
            {storageResetMessage ? (
              <span className={`settings-storage-message settings-storage-message--${storageResetState}`}>
                {storageResetMessage}
              </span>
            ) : null}
          </div>
          <div className="settings-storage-actions">
            <button
              type="button"
              className="settings-export-logs-btn settings-storage-manager-btn"
              disabled={!persistentStorage || subscriptionLoading}
              onClick={() => {
                void handleResetPersistentStorage();
              }}
            >
              <ExternalLink size={16} />
              {t("settings.persistentStorage.openManager")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
