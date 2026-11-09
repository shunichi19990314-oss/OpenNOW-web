import { memo, useCallback, useRef, type RefObject } from "react";
import type { GameInfo } from "@shared/gfn";
import { GameCard } from "./GameCard";

export interface CatalogCardActions {
  onPlayGame: (game: GameInfo) => void;
  onToggleFavorite: (game: GameInfo) => void;
  onViewGameDetails: (game: GameInfo) => void;
  onSelectGame: (gameId: string) => void;
  onSelectGameVariant: (gameId: string, variantId: string) => void;
}

export interface GameCardListItemProps {
  game: GameInfo;
  selectedVariantId?: string;
  isSelected?: boolean;
  isFavorite?: boolean;
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
    && prev.actionsRef === next.actionsRef
  );
}

export const GameCardListItem = memo(function GameCardListItem({
  game,
  selectedVariantId,
  isSelected = false,
  isFavorite = false,
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

  return (
    <GameCard
      game={game}
      isSelected={isSelected}
      selectedVariantId={selectedVariantId}
      onSelect={handleSelect}
      onPlay={handlePlay}
      onSelectStore={handleSelectStore}
      isFavorite={isFavorite}
      onToggleFavorite={handleToggleFavorite}
      onDetails={handleDetails}
    />
  );
}, gameCardListItemPropsAreEqual);

export function useCatalogCardActionsRef(actions: CatalogCardActions): RefObject<CatalogCardActions> {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  return actionsRef;
}
