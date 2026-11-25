import { Keyboard, X } from "lucide-react";
import { useEffect, type JSX } from "react";
import { m } from "motion/react";
import { createPortal } from "react-dom";

import { useTranslation } from "../i18n";
import { panelSpring } from "./MotionProvider";

export interface ShortcutRow {
  keys: string;
  label: string;
}

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Rows already formatted for display (see `formatShortcutForDisplay`). */
  rows: readonly ShortcutRow[];
}

/**
 * "All shortcuts" sheet from the desktop chrome's footer hint.
 *
 * The desktop build prints the hint bar along the bottom edge; a browser page
 * has no room for one, so the same list lives behind a `?` shortcut and the
 * header button. Every key is still the one the app actually binds.
 */
export function ShortcutsOverlay({ open, onClose, rows }: ShortcutsOverlayProps): JSX.Element | null {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <m.div
      className="shortcuts-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("shortcuts.title")}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <m.div
        className="shortcuts-panel"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={panelSpring}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shortcuts-header">
          <div className="shortcuts-title">
            <Keyboard size={18} aria-hidden="true" />
            <h2>{t("shortcuts.title")}</h2>
          </div>
          <button
            type="button"
            className="shortcuts-close"
            onClick={onClose}
            aria-label={t("app.actions.close")}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <ul className="shortcuts-list">
          {rows.map((row) => (
            <li key={`${row.keys}-${row.label}`} className="shortcuts-row">
              <span className="shortcuts-label">{row.label}</span>
              <kbd className="shortcuts-keys">{row.keys}</kbd>
            </li>
          ))}
        </ul>
      </m.div>
    </m.div>,
    document.body,
  );
}
