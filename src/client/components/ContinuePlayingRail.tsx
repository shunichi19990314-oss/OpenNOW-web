import { Clock, History, Play } from "lucide-react";
import { memo, type JSX } from "react";

import type { GameInfo } from "@shared/gfn";

import { useTranslation } from "../i18n";
import { formatTotalPlaytime, playtimeUnits, type RecentActivityEntry } from "../lib/localPreferences";
import { formatCatalogLastPlayed } from "../utils/lastPlayedFormat";

export interface ContinuePlayingRailProps {
  entries: RecentActivityEntry[];
  onPlay: (game: GameInfo) => void;
  onDetails: (game: GameInfo) => void;
  /** How many cards to show; the rail stays scannable on wide screens. */
  limit?: number;
}

/**
 * "Continue playing" rail.
 *
 * The hero carousel already resurfaces the single most recent game; this rail
 * shows the full short list with the numbers that decide what to resume —
 * when it was last played and how long it has been played in total. Rendered
 * from local playtime data, so it works before the catalog reports anything.
 */
export const ContinuePlayingRail = memo(function ContinuePlayingRail({
  entries,
  onPlay,
  onDetails,
  limit = 8,
}: ContinuePlayingRailProps): JSX.Element | null {
  const { t } = useTranslation();
  if (entries.length === 0) return null;

  return (
    <section className="home-row home-continue-row" aria-labelledby="home-continue-heading">
      <h2 className="home-section-title" id="home-continue-heading">
        <span className="home-section-bar" aria-hidden="true" />
        <History size={17} aria-hidden="true" />
        {t("home.continuePlaying.railTitle")}
      </h2>
      <div className="home-row-scroller">
        {entries.slice(0, limit).map((entry) => {
          const { game, lastPlayedMs, totalSeconds, sessionCount } = entry;
          const art = game.heroImageUrl ?? game.imageUrl;
          return (
            <div key={game.id} className="home-continue-tile">
              <button
                type="button"
                className="home-continue-tile-art"
                onClick={() => onDetails(game)}
                aria-label={t("home.hero.details") + `: ${game.title}`}
              >
                {art ? (
                  <img src={art} alt="" loading="lazy" draggable={false} />
                ) : (
                  <span className="home-continue-tile-placeholder" aria-hidden="true">
                    {game.title.slice(0, 1)}
                  </span>
                )}
                <span className="home-continue-tile-play" aria-hidden="true">
                  <Play size={18} fill="currentColor" />
                </span>
              </button>
              <div className="home-continue-tile-body">
                <span className="home-continue-tile-title" title={game.title}>{game.title}</span>
                <span className="home-continue-tile-meta">
                  <Clock size={11} aria-hidden="true" />
                  {formatTotalPlaytime(totalSeconds, t("home.continuePlaying.neverPlayed"), playtimeUnits(t))}
                </span>
                <span className="home-continue-tile-meta home-continue-tile-meta--muted">
                  {lastPlayedMs > 0
                    ? formatCatalogLastPlayed(t, new Date(lastPlayedMs).toISOString())
                    : t("library.lastPlayed.never")}
                  {sessionCount > 0
                    ? ` · ${t("home.continuePlaying.sessionCount", { count: sessionCount })}`
                    : ""}
                </span>
              </div>
              <button
                type="button"
                className="home-continue-tile-resume"
                onClick={() => onPlay(game)}
              >
                <Play size={14} />
                {t("home.continuePlaying.play")}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
});
