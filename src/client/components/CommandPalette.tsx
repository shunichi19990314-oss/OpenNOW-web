import { Search, CornerDownLeft, Command, Gamepad2, Compass, MonitorPlay, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, m } from "motion/react";

import { useTranslation } from "../i18n";
import {
  buildCommandPaletteEntries,
  filterCommandPaletteEntries,
  groupCommandPaletteEntries,
  MAX_GAME_LIMIT,
  type CommandPaletteContext,
  type CommandPaletteEntry,
} from "../lib/commandPalette";
import { overlayMotion } from "./MotionProvider";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  context: CommandPaletteContext;
  /** Runs the entry. The palette closes itself first so focus returns to the app. */
  onRun: (entry: CommandPaletteEntry) => void;
}

const KIND_ICONS = {
  game: Gamepad2,
  page: Compass,
  stream: MonitorPlay,
  action: Sparkles,
} as const;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled]):not([tabindex='-1'])",
  "input:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * True while an IME composition is in progress.
 *
 * This app is Japanese-first and the palette input is a normal text field, so
 * Enter is used to *commit* a conversion. Without this guard, picking a
 * candidate among search results would launch a game or stop the stream.
 */
function isComposing(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const native = event.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number } | undefined;
  return Boolean(native?.isComposing) || native?.keyCode === 229;
}

/**
 * Ctrl/⌘+K command palette.
 *
 * Keyboard-first: the query input always has focus, ArrowUp/Down move the
 * active row, Enter runs it, Escape closes. Mouse hover also moves the active
 * row so pointer and keyboard never disagree about what Enter will do.
 */
export function CommandPalette({ open, onClose, context, onRun }: CommandPaletteProps): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Whatever had focus before the palette opened; restored on close so a
  // keyboard or screen-reader visitor is not dumped back at <body>.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Build the full searchable corpus (bounded by MAX_GAME_LIMIT inside the
  // builder); the render list is still capped by `filterCommandPaletteEntries`.
  const entries = useMemo(
    () => buildCommandPaletteEntries(context, t, MAX_GAME_LIMIT),
    [context, t],
  );
  const filtered = useMemo(
    () => filterCommandPaletteEntries(entries, query, 60),
    [entries, query],
  );
  const groups = useMemo(() => groupCommandPaletteEntries(filtered), [filtered]);

  // Reset per open so a previous search never leaks into the next invocation.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreFocusRef.current = previouslyFocused;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // The row that ran a command may have unmounted (page change), so only
      // restore a target that is still in the document and still focusable.
      if (target && target.isConnected && typeof target.focus === "function") {
        target.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => {
    if (activeIndex < filtered.length) return;
    setActiveIndex(filtered.length > 0 ? filtered.length - 1 : 0);
  }, [filtered.length, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>("[data-palette-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const runEntry = (entry: CommandPaletteEntry | undefined): void => {
    if (!entry) return;
    onClose();
    onRun(entry);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Never let an IME conversion keystroke act as a command.
    if (isComposing(event)) return;
    if (event.key === "Tab") {
      // The dialog is aria-modal, so Tab must not reach the page behind it.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement;
      if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (filtered.length === 0 ? 0 : (current + 1) % filtered.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runEntry(filtered[activeIndex]);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    }
  };

  const shortcutHint = typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K";
  // Flat position of each entry, matching the order the rows are rendered in,
  // so keyboard selection, ARIA and mouse hover all agree without relying on a
  // counter mutated during render.
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    groups.forEach((group) => {
      group.entries.forEach((entry) => map.set(entry.id, map.size));
    });
    return map;
  }, [groups]);

  return (
    <AnimatePresence>
      {open && (
        <m.div
          className="command-palette"
          role="dialog"
          aria-modal="true"
          aria-label={t("commandPalette.title")}
          {...overlayMotion}
        >
          <button
            type="button"
            className="command-palette-backdrop"
            onClick={onClose}
            aria-label={t("commandPalette.close")}
            tabIndex={-1}
          />
          <m.div
            ref={panelRef}
            className="command-palette-panel"
            onKeyDown={handleKeyDown}
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.995 }}
            transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="command-palette-search">
              <Search size={16} className="command-palette-search-icon" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-palette-list"
                aria-activedescendant={filtered[activeIndex] ? `command-palette-${filtered[activeIndex].id}` : undefined}
                aria-autocomplete="list"
                className="command-palette-input"
                placeholder={t("commandPalette.placeholder")}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={(event) => {
                  // Navigation keys are handled by the panel; stopping here keeps
                  // the browser from acting on them (e.g. ArrowUp moving the
                  // caret) before our handler runs.
                  if (isComposing(event)) return;
                  if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.stopPropagation();
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="command-palette-clear"
                  onClick={() => {
                    setQuery("");
                    setActiveIndex(0);
                    inputRef.current?.focus();
                  }}
                  aria-label={t("commandPalette.clear")}
                >
                  <X size={14} />
                </button>
              ) : (
                <span className="command-palette-shortcut" aria-hidden="true">
                  <Command size={12} />
                  {shortcutHint}
                </span>
              )}
            </div>

            <div className="command-palette-list" id="command-palette-list" role="listbox" ref={listRef}>
              {groups.length === 0 ? (
                <div className="command-palette-empty">
                  <p>{t("commandPalette.noResults")}</p>
                  <span>{t("commandPalette.noResultsHint")}</span>
                </div>
              ) : (
                groups.map((group) => (
                  <div key={group.group} className="command-palette-group">
                    <div className="command-palette-group-label">{group.group}</div>
                    {group.entries.map((entry) => {
                      const index = indexById.get(entry.id) ?? 0;
                      const isActive = index === activeIndex;
                      const Icon = KIND_ICONS[entry.kind];
                      return (
                        <button
                          key={entry.id}
                          id={`command-palette-${entry.id}`}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          data-palette-active={isActive ? "true" : "false"}
                          className={`command-palette-item${isActive ? " is-active" : ""}`}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => runEntry(entry)}
                        >
                          <span className="command-palette-item-icon" aria-hidden="true">
                            <Icon size={15} />
                          </span>
                          <span className="command-palette-item-text">
                            <span className="command-palette-item-label">{entry.label}</span>
                            {entry.hint && <span className="command-palette-item-hint">{entry.hint}</span>}
                          </span>
                          {isActive && (
                            <span className="command-palette-item-enter" aria-hidden="true">
                              <CornerDownLeft size={13} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="command-palette-footer">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> {t("commandPalette.footer.navigate")}
              </span>
              <span>
                <kbd>Enter</kbd> {t("commandPalette.footer.run")}
              </span>
              <span>
                <kbd>Esc</kbd> {t("commandPalette.footer.close")}
              </span>
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
