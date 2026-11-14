import { Search, CornerDownLeft, Command, Gamepad2, Compass, MonitorPlay, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, m } from "motion/react";

import { useTranslation } from "../i18n";
import {
  buildCommandPaletteEntries,
  filterCommandPaletteEntries,
  groupCommandPaletteEntries,
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

  const entries = useMemo(
    () => buildCommandPaletteEntries(context, t),
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
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
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
  let runningIndex = -1;

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
                  // Let the panel handler own navigation keys even though the
                  // input itself never receives Enter/Arrow defaults it needs.
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
                      runningIndex += 1;
                      const index = runningIndex;
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
