import { useEffect } from "react";

/**
 * Keyboard-close for overlay dialogs.
 *
 * The details modal and the collection dialog could only be dismissed with the
 * pointer. Escape is the one key every visitor tries first, and on a
 * controller-forward app it is the same gesture the shortcuts overlay already
 * honours — so it belongs on every overlay, not just that one.
 *
 * The listener sits on `window` rather than the dialog element: nothing in
 * these dialogs takes focus on open, so a keydown would otherwise be delivered
 * to `<body>` and never reach the dialog. Handlers that are already busy (an
 * IME composition, a nested popover) can stop propagation; we only act when
 * the event still reaches the window unclaimed.
 */
export function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A composing IME uses Escape to cancel the conversion, not the dialog.
      const native = event as unknown as { isComposing?: boolean; keyCode?: number };
      if (native.isComposing || native.keyCode === 229) return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);
}

/** Keys that move a grid selection; anything else is left to the focused control. */
export type GridArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * True when the keystroke belongs to something the visitor is editing.
 *
 * Global grid navigation must never steal an arrow key from a search field, a
 * select, or a contenteditable — arrows move the caret and open menus there.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as HTMLElement;
  const tag = element.tagName;
  return (
    tag === "INPUT"
    || tag === "TEXTAREA"
    || tag === "SELECT"
    || element.isContentEditable === true
  );
}

export function arrowKeyOf(event: KeyboardEvent): GridArrowKey | null {
  switch (event.key) {
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown":
      return event.key;
    default:
      return null;
  }
}

/**
 * Next selection index for an arrow key, or `null` when the grid should stay
 * put (already at either end).
 *
 * The DOM is not consulted: the card grid is a flow layout whose column count
 * changes with the viewport, so "down" cannot be derived from an index without
 * measuring. Left/Right move one card and Up/Down move a row of `columns`
 * cards, which is what the eye does on a evenly-filled grid; a selection that
 * would leave the list is clamped away instead of wrapping, so holding a key
 * never teleports from the last card to the first.
 */
export function nextGridIndex(current: number, key: GridArrowKey, length: number, columns: number): number | null {
  if (length <= 0) return null;
  const safeCurrent = Math.min(Math.max(current, 0), length - 1);
  const step = Math.max(1, Math.floor(columns));
  switch (key) {
    case "ArrowLeft":
      return safeCurrent > 0 ? safeCurrent - 1 : null;
    case "ArrowRight":
      return safeCurrent < length - 1 ? safeCurrent + 1 : null;
    case "ArrowUp":
      return safeCurrent - step >= 0 ? safeCurrent - step : null;
    case "ArrowDown":
      return safeCurrent + step <= length - 1 ? safeCurrent + step : null;
    default:
      return null;
  }
}

/**
 * Column count of the rendered grid, read from its computed style.
 *
 * `grid-template-columns` resolves to a list of pixel/`fr` tracks once layout
 * has run, so counting them is exact — far better than a hard-coded breakpoint
 * table that drifts from the stylesheet. Returns `fallback` when the element is
 * missing (SSR, hidden page) or the value is the `none` keyword.
 */
export function readGridColumns(element: Element | null, fallback = 2): number {
  if (!element) return fallback;
  const computed = window.getComputedStyle(element).gridTemplateColumns;
  if (!computed || computed === "none") return fallback;
  const tracks = computed.trim().split(/\s+/).filter(Boolean).length;
  return tracks > 0 ? tracks : fallback;
}
