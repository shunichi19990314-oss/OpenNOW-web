import { Check, Gamepad2, Heart, Lock, Monitor, Play, ShoppingCart, Users, X } from "lucide-react";
import type { JSX } from "react";
import type { GameInfo } from "@shared/gfn";
import { useTranslation } from "../i18n";
import { getJapaneseGameDescription } from "../utils/localizedGameText";
import { getStoreDisplayName } from "./GameCard";
import { controlLabel, genreLabel, nvidiaTechLabel, playTypeLabel } from "../lib/gfnLabels";

export interface GameDetailsModalProps {
  game: GameInfo;
  /**
   * Why the account cannot launch this title, when that is the case. The modal
   * then explains it instead of offering a Play button that would fail.
   */
  lockedReason?: string | null;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onPlay: () => void;
  /**
   * Opens the game's page on the store that sells it. GeForce NOW is a
   * streaming client, not a shop: purchases settle in Steam/Epic/…, so the
   * closest the shell can get to "buying it here" is handing the exact
   * product page over without leaving the player to search for it.
   */
  onBuy?: () => void;
  /** True while the store URL is being resolved. */
  isBuyPending?: boolean;
  onClose: () => void;
}

export function GameDetailsModal({
  game,
  isFavorite,
  onToggleFavorite,
  onPlay,
  onBuy,
  isBuyPending = false,
  onClose,
  lockedReason,
}: GameDetailsModalProps): JSX.Element {
  const { t } = useTranslation();
  const stores = (game.availableStores ?? []).map((store) => getStoreDisplayName(store, t));
  const playerCount = [game.maxLocalPlayers, game.maxOnlinePlayers].filter((value): value is number => typeof value === "number" && value > 0);
  const description = getJapaneseGameDescription(game.longDescription, game.description, t("library.descriptionUnavailable"));
  // Catalogue genres/tech arrive as English or screaming-case enums; an
  // unrecognised value is dropped rather than printed as a raw token.
  const tags = [
    ...(game.genres ?? []).map((genre) => genreLabel(genre, t)),
    ...(game.supportedControls ?? []).map((control) => controlLabel(control, t)),
    ...(game.nvidiaTech ?? []).map((tech) => nvidiaTechLabel(tech, t)),
  ].filter((tag): tag is string => Boolean(tag));

  return (
    <div className="game-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="game-details-modal" role="dialog" aria-modal="true" aria-labelledby="game-details-title">
        <button type="button" className="game-details-close" onClick={onClose} aria-label={t("app.actions.close")}>
          <X size={18} />
        </button>
        <div className="game-details-hero">
          {game.heroImageUrl || game.imageUrl ? (
            <img src={game.heroImageUrl || game.imageUrl} alt="" />
          ) : (
            <div className="game-details-hero-placeholder"><Monitor size={42} /></div>
          )}
          <div className="game-details-hero-shade" />
          <div className="game-details-heading">
            <span className="game-details-kicker">{playTypeLabel(game.playType, t) ?? t("library.gameDetails")}</span>
            <h2 id="game-details-title">{game.title}</h2>
          </div>
        </div>
        <div className="game-details-content">
          <div className="game-details-actions">
            {lockedReason && onBuy ? (
              // The reason the title is locked is "not owned yet": offer the
              // store page instead of a dead Play button.
              <button
                type="button"
                className="game-details-play"
                onClick={onBuy}
                disabled={isBuyPending}
              >
                <ShoppingCart size={16} />
                {isBuyPending ? t("gameDetails.openingStore") : t("gameDetails.buyOnStore")}
              </button>
            ) : lockedReason ? (
              <span className="game-details-locked" title={lockedReason}>
                <Lock size={15} aria-hidden="true" />
                {lockedReason}
              </span>
            ) : (
              <button type="button" className="game-details-play" onClick={onPlay}>
                <Play size={16} fill="currentColor" />
                {t("app.actions.play")}
              </button>
            )}
            <button
              type="button"
              className={`game-details-favorite ${isFavorite ? "active" : ""}`}
              onClick={onToggleFavorite}
              aria-pressed={isFavorite}
            >
              <Heart size={16} fill={isFavorite ? "currentColor" : "none"} />
              {isFavorite ? t("gameCard.removeFavorite") : t("gameCard.addFavorite")}
            </button>
          </div>
          {lockedReason && onBuy && (
            <p className="game-details-purchase-note">{t("gameDetails.buyHint")}</p>
          )}
          <p className="game-details-description">{description}</p>
          <div className="game-details-meta">
            {game.developerName && <span><Gamepad2 size={14} />{t("library.developer", { developer: game.developerName })}</span>}
            {game.publisherName && <span><Check size={14} />{t("library.publisher", { publisher: game.publisherName })}</span>}
            {playerCount.length > 0 && <span><Users size={14} />{t("library.players", { players: playerCount.join(" / ") })}</span>}
            {stores.length > 0 && <span>{stores.join(" · ")}</span>}
          </div>
          {tags.length > 0 && (
            <div className="game-details-tags">
              {tags.slice(0, 12).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
