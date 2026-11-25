import { House, Library, Settings, Command, Palette } from "lucide-react";
import type { JSX } from "react";
import { m } from "motion/react";

import { useTranslation } from "../i18n";

export type RailPage = "home" | "library" | "settings";

interface AppRailProps {
  currentPage: RailPage;
  onNavigate: (page: RailPage) => void;
  /** Opens the command palette (Ctrl/⌘+K). */
  onOpenCommandPalette?: () => void;
}

/**
 * Vertical icon rail from the desktop build's Paper shell.
 *
 * The desktop client replaced its top navigation with this rail: brand mark at
 * the top, destinations below, utilities pinned to the bottom. Labels stay
 * available as tooltips and accessible names because the icons alone are not
 * self-describing at this size.
 */
export function AppRail({ currentPage, onNavigate, onOpenCommandPalette }: AppRailProps): JSX.Element {
  const { t } = useTranslation();

  const items: Array<{ id: RailPage; label: string; icon: typeof House }> = [
    { id: "home", label: t("navigation.home"), icon: House },
    { id: "library", label: t("navigation.library"), icon: Library },
    { id: "settings", label: t("navigation.settings"), icon: Settings },
  ];

  return (
    <nav className="app-rail" aria-label={t("navigation.railLabel")}>
      <div className="app-rail-brand" aria-hidden="true">
        <span className="app-rail-mark" />
      </div>

      <div className="app-rail-nav">
        {items.map((item) => {
          const Icon = item.icon;
          const active = currentPage === item.id;
          return (
            <m.button
              key={item.id}
              type="button"
              className={`app-rail-button${active ? " app-rail-button--active" : ""}`}
              onClick={() => onNavigate(item.id)}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              whileTap={{ scale: 0.94 }}
            >
              <Icon size={19} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
            </m.button>
          );
        })}
      </div>

      <div className="app-rail-footer">
        {onOpenCommandPalette && (
          <button
            type="button"
            className="app-rail-button app-rail-button--ghost"
            onClick={onOpenCommandPalette}
            title={t("navigation.commandPalette")}
            aria-label={t("navigation.commandPalette")}
          >
            <Command size={17} aria-hidden="true" />
          </button>
        )}
        <span className="app-rail-divider" aria-hidden="true" />
        <span className="app-rail-badge" title={t("navigation.themePack")} aria-hidden="true">
          <Palette size={15} />
        </span>
      </div>
    </nav>
  );
}
