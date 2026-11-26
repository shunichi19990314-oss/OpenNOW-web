import { Crown, ExternalLink, RefreshCw } from "lucide-react";
import { type JSX } from "react";

import type { SubscriptionInfo } from "@shared/gfn";

import { useTranslation } from "../../../i18n";
import { membershipTierLabel, subscriptionValueLabel } from "../../../lib/gfnLabels";
import { MotionSpinner } from "../../MotionSpinner";

/** NVIDIA account page, where the plan itself is changed. */
const NVIDIA_ACCOUNT_URL = "https://www.nvidia.com/en-us/account/";

export interface SettingsSubscriptionSectionProps {
  showAll: boolean;
  subscriptionInfo: SubscriptionInfo | null;
  subscriptionLoading: boolean;
  /** Re-fetches the entitlements (the desktop page's "Refresh entitlements"). */
  onRefresh?: () => void;
}

/**
 * Subscription section.
 *
 * The Account section only surfaced the persistent-storage add-on, so the plan
 * itself (tier, entitlements, remaining hours) was invisible outside the navbar
 * popover. This is the desktop Subscription page's content: the live tier, the
 * entitlement chips and the two actions that exist — refresh, and manage the
 * plan on NVIDIA's own site.
 */
export function SettingsSubscriptionSection({
  showAll,
  subscriptionInfo,
  subscriptionLoading,
  onRefresh,
}: SettingsSubscriptionSectionProps): JSX.Element {
  const { t } = useTranslation();

  const tierLabel = subscriptionInfo
    ? membershipTierLabel(subscriptionInfo.membershipTier, t)
    : null;
  const stateLabel = subscriptionValueLabel(subscriptionInfo?.state, t);

  // Entitlement chips: the first few resolutions the plan actually allows, then
  // unlimited / remaining hours — same wording as the desktop page.
  const chips: string[] = [];
  for (const entitlement of subscriptionInfo?.entitledResolutions?.slice(0, 4) ?? []) {
    const width = Number(entitlement.width ?? 0);
    const fps = Number(entitlement.fps ?? 0);
    const height = Number(entitlement.height ?? 0);
    const resolution = width >= 3840
      ? "4K"
      : width >= 2560
        ? "1440p"
        : width >= 1920
          ? "1080p"
          : height > 0
            ? `${height}p`
            : "";
    if (resolution) chips.push(fps > 0 ? `${resolution} · ${fps} FPS` : resolution);
  }
  if (subscriptionInfo?.isUnlimited) {
    chips.push(t("settings.subscription.unlimited"));
  } else if (typeof subscriptionInfo?.remainingHours === "number" && subscriptionInfo.remainingHours > 0) {
    chips.push(t("settings.subscription.hoursLeft", { hours: Math.round(subscriptionInfo.remainingHours) }));
  }

  const headline = subscriptionLoading && !subscriptionInfo
    ? t("settings.subscription.loading")
    : tierLabel ?? t("settings.subscription.unavailable");

  return (
    <section className="settings-section">
      {showAll && <div className="settings-section-context">{t("settings.sections.subscription")}</div>}
      <div className="settings-section-header settings-section-header--with-copy">
        <Crown size={18} />
        <div>
          <h2>{t("settings.subscription.title")}</h2>
          <p className="settings-section-subtitle">{t("settings.subscription.description")}</p>
        </div>
      </div>
      <div className="settings-rows">
        <div className="settings-row settings-row--column">
          <div className="settings-subscription-headline">
            <span className="settings-subscription-tier">{headline}</span>
            {stateLabel && <span className="settings-inline-badge settings-inline-badge--codec">{stateLabel}</span>}
          </div>
          {chips.length > 0 && (
            <ul className="settings-subscription-chips">
              {chips.map((chip) => (
                <li key={chip} className="settings-subscription-chip">{chip}</li>
              ))}
            </ul>
          )}
          {!subscriptionInfo && !subscriptionLoading && (
            <p className="settings-hint">{t("settings.subscription.signInHint")}</p>
          )}
        </div>
        <div className="settings-row">
          <label className="settings-label">
            {t("settings.subscription.manage")}
            <span className="settings-hint">{t("settings.subscription.manageHint")}</span>
          </label>
          <div className="settings-updater-actions">
            {onRefresh && (
              <button
                type="button"
                className="settings-export-logs-btn"
                disabled={subscriptionLoading}
                onClick={() => onRefresh()}
              >
                {subscriptionLoading
                  ? <MotionSpinner size={16} label={t("settings.subscription.refreshing")} />
                  : <RefreshCw size={16} />}
                {t("settings.subscription.refresh")}
              </button>
            )}
            <button
              type="button"
              className="settings-export-logs-btn"
              onClick={() => {
                void window.openNow.openExternalUrl(NVIDIA_ACCOUNT_URL);
              }}
            >
              <ExternalLink size={16} />
              {t("settings.subscription.openAccount")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
