import { memo, useCallback, useRef, type MouseEvent, type RefObject } from "react";
import type { GameInfo } from "@shared/gfn";
import type { GameAccess } from "../lib/gameAccess";
import { GameCard } from "./GameCard";

export interface CatalogCardActions {
  onPlayGame: (game: GameInfo) => void;
  onToggleFavorite: (game: GameInfo) => void;
  onViewGameDetails: (game: GameInfo) => void;
  onSelectGame: (gameId: string) => void;
  onSelectGameVariant: (gameId: string, variantId: string) => void;
  /** Opens the card's context menu at the pointer position. */
  onOpenGameMenu?: (game: GameInfo, event: { clientX: number; clientY: number }) => void;
}

export interface GameCardListItemProps {
  game: GameInfo;
  selectedVariantId?: string;
  isSelected?: boolean;
  isFavorite?: boolean;
  /** Entitlement for this game; the card labels it and refuses to launch. */
  access?: GameAccess;
  actionsRef: RefObject<CatalogCardActions>;
}

function gameCardListItemPropsAreEqual(
  prev: GameCardListItemProps,
  next: GameCardListItemProps,
): boolean {
  return (
    prev.game === next.game
    && prev.selectedVariantId === next.selectedVariantId
    && prev.isSelected === next.isSelected
    && prev.isFavorite === next.isFavorite
    && prev.access?.state === next.access?.state
    && prev.access?.tierLabel === next.access?.tierLabel
    && prev.actionsRef === next.actionsRef
  );
}

export const GameCardListItem = memo(function GameCardListItem({
  game,
  selectedVariantId,
  isSelected = false,
  isFavorite = false,
  access,
  actionsRef,
}: GameCardListItemProps) {
  const handleSelect = useCallback(() => {
    actionsRef.current?.onSelectGame(game.id);
  }, [actionsRef, game.id]);

  const handlePlay = useCallback(() => {
    actionsRef.current?.onPlayGame(game);
  }, [actionsRef, game]);

  const handleSelectStore = useCallback((variantId: string) => {
    actionsRef.current?.onSelectGameVariant(game.id, variantId);
  }, [actionsRef, game.id]);

  const handleToggleFavorite = useCallback(() => {
    actionsRef.current?.onToggleFavorite(game);
  }, [actionsRef, game]);

  const handleDetails = useCallback(() => {
    actionsRef.current?.onViewGameDetails(game);
  }, [actionsRef, game]);

  const handleContextMenu = useCallback((event: MouseEvent) => {
    const openMenu = actionsRef.current?.onOpenGameMenu;
    if (!openMenu) return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(game, event);
  }, [actionsRef, game]);

  return (
    <GameCard
      game={game}
      isSelected={isSelected}
      selectedVariantId={selectedVariantId}
      access={access}
      onSelect={handleSelect}
      onPlay={handlePlay}
      onSelectStore={handleSelectStore}
      isFavorite={isFavorite}
      onToggleFavorite={handleToggleFavorite}
      onDetails={handleDetails}
      onContextMenu={handleContextMenu}
    />
  );
}, gameCardListItemPropsAreEqual);

export function useCatalogCardActionsRef(actions: CatalogCardActions): RefObject<CatalogCardActions> {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  return actionsRef;
}
