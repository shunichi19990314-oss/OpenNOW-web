import { Check, Gamepad2, Heart, Monitor, Play, Users, X } from "lucide-react";
import type { JSX } from "react";
import type { GameInfo } from "@shared/gfn";
import { useTranslation } from "../i18n";
import { getJapaneseGameDescription } from "../utils/localizedGameText";
import { getStoreDisplayName } from "./GameCard";
import { playTypeLabel } from "../lib/gfnLabels";

export interface GameDetailsModalProps {
  game: GameInfo;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onPlay: () => void;
  onClose: () => void;
}

export function GameDetailsModal({ game, isFavorite, onToggleFavorite, onPlay, onClose }: GameDetailsModalProps): JSX.Element {
  const { t } = useTranslation();
  const stores = (game.availableStores ?? []).map((store) => getStoreDisplayName(store, t));
  const playerCount = [game.maxLocalPlayers, game.maxOnlinePlayers].filter((value): value is number => typeof value === "number" && value > 0);
  const description = getJapaneseGameDescription(game.longDescription, game.description, t("library.descriptionUnavailable"));

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
            <button type="button" className="game-details-play" onClick={onPlay}>
              <Play size={16} fill="currentColor" />
              {t("app.actions.play")}
            </button>
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
          <p className="game-details-description">{description}</p>
          <div className="game-details-meta">
            {game.developerName && <span><Gamepad2 size={14} />{t("library.developer", { developer: game.developerName })}</span>}
            {game.publisherName && <span><Check size={14} />{t("library.publisher", { publisher: game.publisherName })}</span>}
            {playerCount.length > 0 && <span><Users size={14} />{t("library.players", { players: playerCount.join(" / ") })}</span>}
            {stores.length > 0 && <span>{stores.join(" · ")}</span>}
          </div>
          {((game.genres?.length ?? 0) > 0 || (game.supportedControls?.length ?? 0) > 0 || (game.nvidiaTech?.length ?? 0) > 0) && (
            <div className="game-details-tags">
              {[...(game.genres ?? []), ...(game.supportedControls ?? []), ...(game.nvidiaTech ?? [])].slice(0, 12).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
