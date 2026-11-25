import { Search, X } from "lucide-react";
import { useEffect, useRef, type JSX } from "react";

import { useTranslation } from "../i18n";

interface AppHeaderSearchProps {
  value: string;
  onChange: (value: string) => void;
  /** Optional right-aligned status text, e.g. the region and theme pack. */
  status?: string;
}

/**
 * Search field in the desktop shell's header (`AppChrome.qml` has one at the
 * top right with a `/` hint). It drives the same query the page toolbars use,
 * so typing here filters Home/Library instead of introducing a second source
 * of truth. The `/` shortcut still focuses it through `data-global-search`.
 */
export function AppHeaderSearch({ value, onChange, status }: AppHeaderSearchProps): JSX.Element {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable
      ));
      if (typing) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="app-header-search">
      <Search size={15} className="app-header-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        className="app-header-search-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("home.searchPlaceholder")}
        aria-label={t("home.searchPlaceholder")}
        data-global-search="header"
      />
      {value ? (
        <button
          type="button"
          className="app-header-search-clear"
          onClick={() => onChange("")}
          aria-label={t("home.search.clear")}
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : (
        <kbd className="app-header-search-kbd" aria-hidden="true">/</kbd>
      )}
      {status && <span className="app-header-status">{status}</span>}
    </div>
  );
}
