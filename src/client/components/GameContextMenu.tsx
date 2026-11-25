import { Check, FolderPlus, Heart, Info, Play } from "lucide-react";
import { useEffect, useRef, type JSX } from "react";
import { createPortal } from "react-dom";

import type { GameInfo } from "@shared/gfn";

import { useTranslation } from "../i18n";
import type { GameCollection } from "../lib/collections";

export interface GameContextMenuState {
  game: GameInfo;
  x: number;
  y: number;
}

interface GameContextMenuProps {
  state: GameContextMenuState;
  collections: readonly GameCollection[];
  isFavorite: boolean;
  onClose: () => void;
  onPlay: () => void;
  onDetails: () => void;
  onToggleFavorite: () => void;
  onToggleCollection: (collectionId: string) => void;
  onCreateCollection: () => void;
}

/**
 * Right-click menu on a library tile.
 *
 * The desktop Library advertises "right-click a game for actions" and the menu
 * is how a game joins a collection. The web client had no right-click surface
 * at all, so collections were unreachable.
 */
export function GameContextMenu({
  state,
  collections,
  isFavorite,
  onClose,
  onPlay,
  onDetails,
  onToggleFavorite,
  onToggleCollection,
  onCreateCollection,
}: GameContextMenuProps): JSX.Element {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // Keep the menu inside the viewport: a tile near the right/bottom edge would
  // otherwise open a menu the visitor cannot reach.
  const menuWidth = 240;
  const menuHeight = 132 + Math.min(collections.length, 8) * 30;
  const left = Math.min(state.x, Math.max(8, window.innerWidth - menuWidth - 8));
  const top = Math.min(state.y, Math.max(8, window.innerHeight - menuHeight - 8));
  const memberIds = new Set(
    collections.filter((collection) => collection.gameIds.includes(state.game.id)).map((collection) => collection.id),
  );

  return createPortal(
    <div
      ref={menuRef}
      className="game-context-menu"
      style={{ left, top }}
      role="menu"
      aria-label={t("gameContext.menuLabel", { title: state.game.title })}
    >
      <div className="game-context-menu-title">{state.game.title}</div>
      <button type="button" role="menuitem" className="game-context-menu-item" onClick={onPlay}>
        <Play size={14} aria-hidden="true" />
        {t("home.hero.play")}
      </button>
      <button type="button" role="menuitem" className="game-context-menu-item" onClick={onDetails}>
        <Info size={14} aria-hidden="true" />
        {t("home.hero.details")}
      </button>
      <button type="button" role="menuitem" className="game-context-menu-item" onClick={onToggleFavorite}>
        <Heart size={14} fill={isFavorite ? "currentColor" : "none"} aria-hidden="true" />
        {isFavorite ? t("library.filterOptions.favorite") : t("gameCard.addFavorite")}
      </button>
      <div className="game-context-menu-separator" role="separator" />
      <div className="game-context-menu-heading">{t("collections.addToCollection")}</div>
      <div className="game-context-menu-collections">
        {collections.length === 0 && (
          <p className="game-context-menu-empty">{t("collections.emptyHint")}</p>
        )}
        {collections.map((collection) => {
          const member = memberIds.has(collection.id);
          return (
            <button
              key={collection.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={member}
              className="game-context-menu-item game-context-menu-item--collection"
              onClick={() => onToggleCollection(collection.id)}
            >
              <span className="game-context-menu-check" aria-hidden="true">
                {member ? <Check size={13} /> : null}
              </span>
              <span className="game-context-menu-collection-name">{collection.name}</span>
            </button>
          );
        })}
      </div>
      <div className="game-context-menu-separator" role="separator" />
      <button type="button" role="menuitem" className="game-context-menu-item" onClick={onCreateCollection}>
        <FolderPlus size={14} aria-hidden="true" />
        {t("collections.newCollection")}
      </button>
    </div>,
    document.body,
  );
}
