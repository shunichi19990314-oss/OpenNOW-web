import { Gamepad2, Users } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

import { useTranslation } from "../i18n";
import {
  MAX_LOCAL_PLAYERS,
  PROVIDER_SOCIAL_CAPABILITIES,
  hasSecondLocalPlayer,
  toLocalControllerSlots,
  type LocalController,
} from "../lib/social";

export interface FriendsPageProps {
  /** Opens controller settings for the local co-op slots. */
  onOpenControllerSettings?: () => void;
}

/**
 * Friends page, ported from the desktop client's Friends route.
 *
 * The desktop build is explicit here: provider presence and invitations are not
 * available to third-party clients, so the screen says so instead of listing
 * contacts. What does work — up to four controllers on this device becoming
 * separate players — is shown with the pads connected right now.
 */
export function FriendsPage({ onOpenControllerSettings }: FriendsPageProps): JSX.Element {
  const { t } = useTranslation();
  const capabilities = PROVIDER_SOCIAL_CAPABILITIES;
  const [controllers, setControllers] = useState<LocalController[]>([]);

  useEffect(() => {
    const read = (): LocalController[] => (
      typeof navigator === "undefined"
        ? []
        : toLocalControllerSlots(navigator.getGamepads?.(), t("friends.controllerFallback"))
    );
    setControllers(read());
    const handleChange = (): void => setControllers(read());
    window.addEventListener("gamepadconnected", handleChange);
    window.addEventListener("gamepaddisconnected", handleChange);
    return () => {
      window.removeEventListener("gamepadconnected", handleChange);
      window.removeEventListener("gamepaddisconnected", handleChange);
    };
  }, [t]);

  const playerTwoReady = hasSecondLocalPlayer(controllers);
  // Always show player one's slot so the panel never looks broken with no pads.
  const slotCount = Math.min(MAX_LOCAL_PLAYERS, Math.max(2, controllers.length + 1));

  return (
    <div className="friends-page">
      <section className="friends-hero" aria-labelledby="friends-hero-title">
        <span className="friends-badge">
          <span className="friends-badge-dot" aria-hidden="true" />
          {t("friends.comingSoon")}
        </span>
        <h2 id="friends-hero-title" className="friends-hero-title">{t("friends.title")}</h2>
        <p className="friends-hero-body">{t("friends.body")}</p>
        <p className="friends-hero-reason">{capabilities.reason}</p>
      </section>

      <section className="friends-coop" aria-labelledby="friends-coop-title">
        <span className="friends-coop-eyebrow">{t("friends.coopEyebrow")}</span>
        <h3 id="friends-coop-title">{t("friends.coopTitle")}</h3>
        <p className="friends-coop-body">{t("friends.coopBody")}</p>

        <ul className="friends-slots">
          {Array.from({ length: slotCount }, (_unused, index) => {
            const controller = controllers[index];
            return (
              <li
                key={index}
                className={`friends-slot${controller ? " friends-slot--connected" : ""}`}
              >
                <span className="friends-slot-badge" aria-hidden="true">P{index + 1}</span>
                <span className="friends-slot-name">
                  {controller ? controller.name : t("friends.slotWaiting")}
                </span>
                <span className="friends-slot-state">
                  {controller ? t("friends.slotConnected") : t("friends.slotEmpty")}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="friends-coop-actions">
          <button
            type="button"
            className="friends-primary-action"
            onClick={() => onOpenControllerSettings?.()}
          >
            <Gamepad2 size={16} />
            {playerTwoReady ? t("friends.setUpPlayerTwo") : t("friends.connectController")}
          </button>
          {onOpenControllerSettings && (
            <button type="button" className="friends-secondary-action" onClick={onOpenControllerSettings}>
              <Users size={16} />
              {t("friends.controllerSettings")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
