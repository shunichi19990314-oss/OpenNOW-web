import { Heart, Search, LayoutGrid, ArrowUpDown, Filter, ChevronDown, Gamepad2, Menu, Play, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { AnimatePresence, m } from "motion/react";
import { isOwnedLibraryStatus } from "@shared/gfn";
import type { CatalogFilterGroup, CatalogSortOption, GameInfo, GamePanelResult, GameVariant } from "@shared/gfn";
import { getStoreDisplayName, getStoreIconComponent } from "./GameCard";
import { playTypeLabel, type TranslateFn } from "../lib/gfnLabels";
import { formatCatalogLastPlayed } from "../utils/lastPlayedFormat";
import { GameCardListItem, useCatalogCardActionsRef } from "./GameCardListItem";
import { GameDetailsModal } from "./GameDetailsModal";
import { appendImageType, appendUnique, gameMatchesActiveSession } from "../lib/controllerCatalogUi";
import { gameActivityTimestamp, summarizeRecentActivity } from "../lib/localPreferences";
import type { PlaytimeData } from "../lib/gameCatalog";
import { ContinuePlayingRail } from "./ContinuePlayingRail";
import { useTranslation } from "../i18n";
import { controllerButton, readControllerGamepadButtons } from "../utils/controllerGamepad";
import { pageTransition, panelSpring } from "./MotionProvider";
import { SelectDropdown } from "./ui/SelectDropdown";
import { MotionSpinner } from "./MotionSpinner";

const CONTROLLER_STORE_HERO_ROTATION_MS = 7000;
const CONTROLLER_MOVE_REPEAT_MS = 140;

const CONTROLLER_STORE_PROMINENT_IMAGE_KEYS = [
  "MARQUEE_HERO_IMAGE",
  "HERO_IMAGE",
  "TV_BANNER",
  "FEATURE_IMAGE",
  "KEY_ART",
  "KEY_IMAGE",
  "GAME_BOX_ART",
] as const;

const CONTROLLER_STORE_TILE_IMAGE_KEYS = [
  "TV_BANNER",
  "HERO_IMAGE",
  "KEY_IMAGE",
  "KEY_ART",
  "GAME_BOX_ART",
  "FEATURE_IMAGE",
] as const;

export interface HomePageProps {
  games: GameInfo[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onPlayGame: (game: GameInfo) => void;
  favoriteGameIds: string[];
  onToggleFavorite: (game: GameInfo) => void;
  isLoading: boolean;
  selectedGameId: string;
  onSelectGame: (id: string) => void;
  selectedVariantByGameId: Record<string, string>;
  onSelectGameVariant: (gameId: string, variantId: string) => void;
  filterGroups: CatalogFilterGroup[];
  selectedFilterIds: string[];
  onToggleFilter: (filterId: string) => void;
  onClearFilters: () => void;
  sortOptions: CatalogSortOption[];
  selectedSortId: string;
  onSortChange: (sortId: string) => void;
  totalCount: number;
  supportedCount: number;
  controllerMode?: boolean;
  storePanels?: GamePanelResult[];
  storeHeroGames?: GameInfo[];
  activeSessionAppIds?: number[];
  onBuyGame?: (game: GameInfo, selectedVariantId?: string) => void;
  onMarkGameOwned?: (game: GameInfo, selectedVariantId?: string) => void;
  markOwnedInFlightByVariantId?: Record<string, boolean>;
  onPreviousControllerPage?: () => void;
  onNextControllerPage?: () => void;
  /** Local playtime + activity data, used by the "Continue playing" rail. */
  playtimeData?: PlaytimeData;
  /**
   * True while the featured/hero request is in flight. The hero needs its own
   * request, so without this the page showed no hero and then inserted one
   * later, pushing the rows down.
   */
  isHeroPending?: boolean;
}

function getSteamHeaderUrl(game: GameInfo): string | undefined {
  const steamVariant = game.variants.find((variant) => /^\d+$/.test(variant.id) && variant.store.toUpperCase().includes("STEAM"));
  const appId = steamVariant?.id ?? (/^\d+$/.test(game.launchAppId ?? "") ? game.launchAppId : undefined);
  return appId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg` : undefined;
}

function getControllerStoreImageCandidates(game: GameInfo, prominent: boolean): string[] {
  const candidates: string[] = [];
  const keys = prominent ? CONTROLLER_STORE_PROMINENT_IMAGE_KEYS : CONTROLLER_STORE_TILE_IMAGE_KEYS;
  for (const type of keys) appendImageType(candidates, game, type);
  appendUnique(candidates, game.heroImageUrl);
  appendUnique(candidates, game.imageUrl);
  for (const screenshot of game.screenshotUrls ?? []) {
    appendUnique(candidates, screenshot);
    if (!prominent) break;
  }
  appendUnique(candidates, game.screenshotUrl);
  appendUnique(candidates, getSteamHeaderUrl(game));
  return candidates;
}

function getControllerStoreLogoUrl(game: GameInfo): string | undefined {
  return game.imageUrlsByType?.GAME_LOGO?.[0]
    ?? game.imageUrlsByType?.LOGO?.[0]
    ?? game.imageUrlsByType?.TITLE_LOGO?.[0];
}

function getSelectedVariant(game: GameInfo, selectedVariantId?: string): GameVariant | undefined {
  return game.variants.find((variant) => variant.id === selectedVariantId)
    ?? game.variants[game.selectedVariantIndex]
    ?? game.variants[0];
}

function storeVariantIsOwned(variant: GameVariant | undefined): boolean {
  return Boolean(variant?.inLibrary || variant?.librarySelected || isOwnedLibraryStatus(variant?.libraryStatus));
}

function getVariantDisplayName(variant: GameVariant | undefined, fallback: string, t: TranslateFn): string {
  return variant?.store ? getStoreDisplayName(variant.store, t) : fallback;
}

function getPurchaseUrl(game: GameInfo, selectedVariantId?: string): string | undefined {
  const selectedVariant = getSelectedVariant(game, selectedVariantId);
  if (selectedVariant?.storeUrl) return selectedVariant.storeUrl;
  return game.variants.find((variant) => !storeVariantIsOwned(variant) && variant.storeUrl)?.storeUrl
    ?? game.variants.find((variant) => variant.storeUrl)?.storeUrl;
}

function gameNeedsPurchase(game: GameInfo, selectedVariantId?: string): boolean {
  const selectedVariant = getSelectedVariant(game, selectedVariantId);
  return !storeVariantIsOwned(selectedVariant);
}

function getNextVariantId(game: GameInfo, selectedVariantId?: string): string | undefined {
  if (game.variants.length === 0) return undefined;
  const activeIndex = Math.max(0, game.variants.findIndex((variant) => variant.id === selectedVariantId));
  return game.variants[(activeIndex + 1) % game.variants.length]?.id;
}

/**
 * Genre chip for the hero.
 *
 * `playType` is a machine enum (`FREE_TO_PLAY`), so it is translated rather than
 * printed; when the catalog has neither a genre nor a recognisable play type we
 * say nothing instead of inventing an English label.
 */
function getPrimaryGenre(game: GameInfo, t: TranslateFn): string | null {
  return game.genres?.[0] ?? playTypeLabel(game.playType, t);
}

function getPrimaryStoreName(game: GameInfo, t: TranslateFn, selectedVariantId?: string): string {
  const store = getSelectedVariant(game, selectedVariantId)?.store ?? game.availableStores?.[0] ?? t("library.cloudStore");
  const upper = store.toUpperCase();
  if (upper.includes("STEAM")) return "Steam";
  if (upper.includes("BATTLE")) return "Battle.net";
  if (upper.includes("UBISOFT") || upper.includes("UPLAY")) return "Ubisoft";
  if (upper.includes("XBOX")) return "Xbox";
  if (upper.includes("EPIC")) return "Epic";
  if (upper.includes("EA")) return "EA";
  return getStoreDisplayName(store, t);
}

function ControllerStoreTile({
  game,
  selectedVariantId,
  focused,
  onFocus,
  onMarkOwned,
  onPlay,
  isMarkingOwned,
}: {
  game: GameInfo;
  selectedVariantId?: string;
  focused: boolean;
  onFocus: () => void;
  onMarkOwned: () => void;
  onPlay: () => void;
  isMarkingOwned: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const imageUrl = getControllerStoreImageCandidates(game, false)[0];
  const selectedVariant = getSelectedVariant(game, selectedVariantId);
  const storeName = getPrimaryStoreName(game, t, selectedVariantId);
  const StoreIcon = getStoreIconComponent(selectedVariant?.store ?? storeName);
  const needsPurchase = gameNeedsPurchase(game, selectedVariantId);

  return (
    <m.div
      role="button"
      tabIndex={0}
      className={`controller-store-tile${focused ? " focused" : ""}`}
      onClick={onFocus}
      onDoubleClick={() => {
        if (needsPurchase) {
          onMarkOwned();
          return;
        }
        onPlay();
      }}
      aria-label={game.title}
      animate={{ scale: focused ? 1.055 : 1 }}
      whileTap={{ scale: 0.98 }}
      transition={panelSpring}
    >
      <span className="controller-store-tile-art">
        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <span className="controller-store-tile-placeholder">{game.title.slice(0, 1)}</span>}
      </span>
      <span className="controller-store-tile-gradient" />
      <span className="controller-store-tile-shine" />
      <span className="controller-store-tile-accent" />
      <span className="controller-store-tile-badge">
        <StoreIcon />
        <span>{storeName}</span>
      </span>
      <span className={`controller-store-tile-ownership${needsPurchase ? " is-not-owned" : " is-owned"}`}>
        {needsPurchase ? t("home.controller.notOwned") : t("home.controller.owned")}
      </span>
      {!needsPurchase && (
        <span className="controller-store-tile-variant">
          {t("home.controller.variant", { variant: getVariantDisplayName(selectedVariant, storeName, t) })}
        </span>
      )}
      <button
        type="button"
        className="controller-store-tile-action"
        onClick={(event) => {
          event.stopPropagation();
          onFocus();
          if (needsPurchase) {
            onMarkOwned();
            return;
          }
          onPlay();
        }}
        disabled={isMarkingOwned}
      >
        {needsPurchase ? (isMarkingOwned ? t("app.status.markingOwned") : t("app.actions.markAsOwned")) : t("app.actions.play")}
      </button>
    </m.div>
  );
}

export const HomePage = memo(function HomePage({
  games,
  searchQuery,
  onSearchChange,
  onPlayGame,
  favoriteGameIds,
  onToggleFavorite,
  isLoading,
  selectedGameId,
  onSelectGame,
  selectedVariantByGameId,
  onSelectGameVariant,
  filterGroups,
  selectedFilterIds,
  onToggleFilter,
  onClearFilters,
  sortOptions,
  selectedSortId,
  onSortChange,
  totalCount,
  supportedCount,
  controllerMode = false,
  storePanels = [],
  storeHeroGames = [],
  activeSessionAppIds: _activeSessionAppIds = [],
  onBuyGame,
  onMarkGameOwned,
  markOwnedInFlightByVariantId = {},
  onPreviousControllerPage,
  onNextControllerPage,
  playtimeData = {},
  isHeroPending = false,
}: HomePageProps): JSX.Element {
  const { t } = useTranslation();
  const [detailsGame, setDetailsGame] = useState<GameInfo | null>(null);
  const catalogActionsRef = useCatalogCardActionsRef({
    onPlayGame,
    onToggleFavorite,
    onViewGameDetails: setDetailsGame,
    onSelectGame,
    onSelectGameVariant,
  });
  const [controllerHeroIndex, setControllerHeroIndex] = useState(0);
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const [focusedColumnIndex, setFocusedColumnIndex] = useState(0);
  const [controllerSearchOpen, setControllerSearchOpen] = useState(false);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const controllerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const gamepadPreviousButtonsRef = useRef(0);
  const gamepadLastMoveAtRef = useRef(0);
  const gamepadFrameRef = useRef<number | null>(null);
  const controllerInputStateRef = useRef({
    focusTile: (_row: number, _column: number): void => {},
    launchFocusedTile: (): void => {},
    cycleFocusedVariant: (): boolean => false,
    focusedRowIndex: 0,
    focusedColumnIndex: 0,
  });

  const controllerSections = useMemo(
    () => storePanels.flatMap((panel) => panel.sections).filter((section) => section.games.length > 0),
    [storePanels],
  );
  const controllerHeroGames = useMemo(
    () => storeHeroGames.slice(0, 6),
    [storeHeroGames],
  );

  const focusTile = (rowIndex: number, columnIndex: number): void => {
    if (controllerSections.length === 0) return;
    const nextRowIndex = Math.max(0, Math.min(rowIndex, controllerSections.length - 1));
    const row = controllerSections[nextRowIndex];
    if (!row || row.games.length === 0) return;
    const nextColumnIndex = Math.max(0, Math.min(columnIndex, row.games.length - 1));
    const nextGame = row.games[nextColumnIndex];
    setFocusedRowIndex(nextRowIndex);
    setFocusedColumnIndex(nextColumnIndex);
    onSelectGame(nextGame.id);
    window.requestAnimationFrame(() => {
      const tile = rowRefs.current[nextRowIndex]?.querySelector<HTMLElement>(`[data-controller-store-column="${nextColumnIndex}"]`);
      tile?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "auto" });
      tile?.closest(".controller-store-section")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    });
  };

  const launchGame = (game: GameInfo): void => {
    const selectedVariantId = selectedVariantByGameId[game.id];
    if (gameNeedsPurchase(game, selectedVariantId)) {
      (onMarkGameOwned ?? onBuyGame)?.(game, selectedVariantId);
      return;
    }
    onPlayGame(game);
  };

  const launchFocusedTile = (): void => {
    const game = controllerSections[focusedRowIndex]?.games[focusedColumnIndex];
    if (game) launchGame(game);
  };

  const cycleFocusedVariant = (): boolean => {
    const game = controllerSections[focusedRowIndex]?.games[focusedColumnIndex];
    if (!game || game.variants.length <= 1) return false;
    const nextVariantId = getNextVariantId(game, selectedVariantByGameId[game.id]);
    if (!nextVariantId) return false;
    onSelectGameVariant(game.id, nextVariantId);
    return true;
  };

  useEffect(() => {
    controllerInputStateRef.current = {
      focusTile,
      launchFocusedTile,
      cycleFocusedVariant,
      focusedRowIndex,
      focusedColumnIndex,
    };
  }, [cycleFocusedVariant, focusedColumnIndex, focusedRowIndex, focusTile, launchFocusedTile]);

  useEffect(() => {
    if (!controllerMode || !controllerSearchOpen) return;
    controllerSearchInputRef.current?.focus();
  }, [controllerMode, controllerSearchOpen]);

  useEffect(() => {
    if (!controllerMode) return;
    setControllerHeroIndex(0);
  }, [controllerHeroGames, controllerMode]);

  useEffect(() => {
    if (!controllerMode || controllerHeroGames.length <= 1) return;
    const interval = window.setInterval(() => {
      setControllerHeroIndex((index) => (index + 1) % controllerHeroGames.length);
    }, CONTROLLER_STORE_HERO_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [controllerHeroGames.length, controllerMode]);

  useEffect(() => {
    if (!controllerMode || controllerSections.length === 0) return;
    const currentRow = controllerSections[focusedRowIndex];
    if (currentRow?.games.some((game) => game.id === selectedGameId)) return;
    focusTile(0, 0);
  }, [controllerMode, controllerSections, focusedRowIndex, selectedGameId]);

  useEffect(() => {
    if (!controllerMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (controllerSearchOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setControllerSearchOpen(false);
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusTile(focusedRowIndex, focusedColumnIndex - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        focusTile(focusedRowIndex, focusedColumnIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusTile(focusedRowIndex - 1, focusedColumnIndex);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        focusTile(focusedRowIndex + 1, focusedColumnIndex);
      } else if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        setControllerSearchOpen(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onPreviousControllerPage?.();
      } else if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        onPreviousControllerPage?.();
      } else if (event.key === "[") {
        event.preventDefault();
        onPreviousControllerPage?.();
      } else if (event.key === "]") {
        event.preventDefault();
        onNextControllerPage?.();
      } else if (event.key.toLowerCase() === "m" || event.key.toLowerCase() === "y") {
        event.preventDefault();
        cycleFocusedVariant();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        launchFocusedTile();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controllerMode, controllerSearchOpen, cycleFocusedVariant, focusedColumnIndex, focusedRowIndex, focusTile, launchFocusedTile, onNextControllerPage, onPreviousControllerPage]);

  useEffect(() => {
    if (!controllerMode) return;
    const readButtons = (): number => {
      const pad = navigator.getGamepads?.().find((gamepad): gamepad is Gamepad => Boolean(gamepad));
      return readControllerGamepadButtons(pad);
    };

    const handleGamepadFrame = () => {
      const buttons = readButtons();
      let pressed = buttons & ~gamepadPreviousButtonsRef.current;
      const moveMask = controllerButton.up | controllerButton.down | controllerButton.left | controllerButton.right;
      const now = performance.now();
      const activeMoves = buttons & moveMask;
      const pressedMoves = pressed & moveMask;
      if (pressedMoves) {
        gamepadLastMoveAtRef.current = now;
      } else if (activeMoves && now - gamepadLastMoveAtRef.current > CONTROLLER_MOVE_REPEAT_MS) {
        pressed |= activeMoves;
        gamepadLastMoveAtRef.current = now;
      }

      const {
        focusTile: focusControllerTile,
        launchFocusedTile: launchControllerTile,
        cycleFocusedVariant: cycleControllerVariant,
        focusedRowIndex: rowIndex,
        focusedColumnIndex: columnIndex,
      } = controllerInputStateRef.current;

      if (controllerSearchOpen) {
        if (pressed & controllerButton.east) setControllerSearchOpen(false);
        gamepadPreviousButtonsRef.current = buttons;
        gamepadFrameRef.current = window.requestAnimationFrame(handleGamepadFrame);
        return;
      }

      if (pressed & controllerButton.south) launchControllerTile();
      if (pressed & controllerButton.east) onPreviousControllerPage?.();
      if (pressed & controllerButton.west) setControllerSearchOpen(true);
      if (pressed & controllerButton.leftShoulder) onPreviousControllerPage?.();
      if (pressed & controllerButton.rightShoulder) onNextControllerPage?.();
      if (pressed & controllerButton.menu) cycleControllerVariant();
      if (pressed & controllerButton.up) focusControllerTile(rowIndex - 1, columnIndex);
      if (pressed & controllerButton.down) focusControllerTile(rowIndex + 1, columnIndex);
      if (pressed & controllerButton.left) focusControllerTile(rowIndex, columnIndex - 1);
      if (pressed & controllerButton.right) focusControllerTile(rowIndex, columnIndex + 1);
      gamepadPreviousButtonsRef.current = buttons;
      gamepadFrameRef.current = window.requestAnimationFrame(handleGamepadFrame);
    };

    const startGamepadNavigation = () => {
      if (gamepadFrameRef.current !== null) return;
      gamepadPreviousButtonsRef.current = readButtons();
      gamepadLastMoveAtRef.current = performance.now();
      gamepadFrameRef.current = window.requestAnimationFrame(handleGamepadFrame);
    };

    const stopGamepadNavigation = () => {
      if (gamepadFrameRef.current !== null) {
        window.cancelAnimationFrame(gamepadFrameRef.current);
        gamepadFrameRef.current = null;
      }
      gamepadPreviousButtonsRef.current = 0;
      gamepadLastMoveAtRef.current = 0;
    };

    const handleDisconnect = () => {
      const hasConnectedPad = navigator.getGamepads?.().some(Boolean) ?? false;
      if (!hasConnectedPad) stopGamepadNavigation();
    };

    window.addEventListener("gamepadconnected", startGamepadNavigation);
    window.addEventListener("gamepaddisconnected", handleDisconnect);
    startGamepadNavigation();

    return () => {
      window.removeEventListener("gamepadconnected", startGamepadNavigation);
      window.removeEventListener("gamepaddisconnected", handleDisconnect);
      stopGamepadNavigation();
    };
  }, [controllerMode, controllerSearchOpen, onNextControllerPage, onPreviousControllerPage]);

  const gameGridItems = useMemo(
    () => games.map((game) => (
      <GameCardListItem
        key={game.id}
        game={game}
        isSelected={game.id === selectedGameId}
        isFavorite={favoriteGameIds.includes(game.id)}
        selectedVariantId={selectedVariantByGameId[game.id]}
        actionsRef={catalogActionsRef}
      />
    )),
    [catalogActionsRef, favoriteGameIds, games, selectedGameId, selectedVariantByGameId],
  );

  // "Continue playing" hero: most recently played owned game, hidden while
  // searching so results stay the focus.
  //
  // The local tracker is read as well as the catalog, so a game played in this
  // browser fills the hero immediately — even before the server reports
  // `lastPlayed` — and the hero cannot disagree with the rail below it.
  const continueGame = useMemo(() => {
    if (searchQuery.trim()) return null;
    let best: GameInfo | null = null;
    let bestTime = 0;
    for (const game of games) {
      const owned = game.isInLibrary === true
        || (game.variants ?? []).some((variant) => isOwnedLibraryStatus(variant.libraryStatus));
      if (!owned) continue;
      const time = gameActivityTimestamp(game, playtimeData);
      if (time > bestTime) {
        bestTime = time;
        best = game;
      }
    }
    return best;
  }, [games, playtimeData, searchQuery]);

  // Full "Continue playing" rail: hero resurfaces only the single newest game,
  // this lists the rest with playtime totals so resuming needs no search.
  const recentActivity = useMemo(() => {
    if (searchQuery.trim() || selectedFilterIds.length > 0) return [];
    // The hero already presents the newest entry as a full-width slide.
    const entries = summarizeRecentActivity(games, playtimeData);
    return entries.filter((entry) => entry.game.id !== continueGame?.id);
  }, [continueGame?.id, games, playtimeData, searchQuery, selectedFilterIds.length]);

  // Featured hero carousel: the resume slot leads, then de-duped featured
  // games. Only shown while browsing (no search/filter) so results stay the
  // focus; falls back to the compact continue card when there is no hero.
  const heroSlides = useMemo(() => {
    const slides: Array<{ game: GameInfo; isResume: boolean }> = [];
    if (continueGame) {
      slides.push({ game: continueGame, isResume: true });
    }
    for (const game of storeHeroGames) {
      if (slides.length >= 6) break;
      if (slides.some((entry) => entry.game.id === game.id)) continue;
      slides.push({ game, isResume: false });
    }
    return slides;
  }, [continueGame, storeHeroGames]);

  const browsingCatalog = searchQuery.trim().length === 0 && selectedFilterIds.length === 0;
  const showHero = browsingCatalog && heroSlides.length > 0;
  // Reserve the hero's box while its data is still loading so the rows below
  // do not jump down when it appears. Once loading finishes with no slides
  // (no featured games, nothing played yet) the placeholder disappears.
  const showHeroPlaceholder = browsingCatalog && !showHero && (isHeroPending || games.length === 0);
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const safeHeroIndex = showHero ? heroIndex % heroSlides.length : 0;

  useEffect(() => {
    if (!showHero || heroPaused || heroSlides.length < 2) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroSlides.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [showHero, heroPaused, heroSlides.length]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isTyping = Boolean(target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ));
      if (isTyping || event.key !== "/") return;
      event.preventDefault();
      document.querySelector<HTMLInputElement>("[data-global-search='home']")?.focus();
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  // Curated collections as horizontally scrollable rows (same extraction as
  // the controller theater), capped so the page stays scannable.
  const homeRows = useMemo(
    () => (browsingCatalog ? controllerSections.slice(0, 4) : []),
    [browsingCatalog, controllerSections],
  );

  if (controllerMode) {
    const showInitialLoading = isLoading && controllerSections.length === 0;
    const heroGame = controllerHeroGames[controllerHeroIndex];
    const heroImageUrl = heroGame ? getControllerStoreImageCandidates(heroGame, true)[0] : undefined;
    const heroLogoUrl = heroGame ? getControllerStoreLogoUrl(heroGame) : undefined;
    const heroSelectedVariantId = heroGame ? selectedVariantByGameId[heroGame.id] : undefined;
    const heroSelectedVariant = heroGame ? getSelectedVariant(heroGame, heroSelectedVariantId) : undefined;
    const heroNeedsOwnership = heroGame ? gameNeedsPurchase(heroGame, heroSelectedVariantId) : false;
    const heroMarkingOwned = Boolean(heroNeedsOwnership && heroSelectedVariant?.id && markOwnedInFlightByVariantId[heroSelectedVariant.id]);
    const heroDotCount = Math.min(Math.max(controllerHeroGames.length, 1), 6);
    const activeHeroDotIndex = controllerHeroGames.length > 0 ? Math.min(controllerHeroIndex % heroDotCount, heroDotCount - 1) : 0;

    return (
      <div className="home-page controller-store-page">
        {showInitialLoading ? (
          <div className="home-empty-state controller-store-empty">
            <MotionSpinner className="home-spinner" size={54} label={t("common.loading")} />
            <p>{t("home.empty.loadingGames")}</p>
          </div>
        ) : controllerSections.length === 0 ? (
          <div className="home-empty-state controller-store-empty">
            <Gamepad2 className="home-empty-icon" size={64} />
            <h3>{t("home.controller.emptyTitle")}</h3>
            <p>{t("home.controller.emptyBody")}</p>
          </div>
        ) : (
          <>
            {heroGame && (
              <section className="controller-hero controller-store-hero" aria-label={heroGame.title}>
                <AnimatePresence initial={false} mode="popLayout">
                  {heroImageUrl ? (
                    <m.img
                      key={heroImageUrl}
                      src={heroImageUrl}
                      alt=""
                      className="controller-hero-image"
                      initial={{ opacity: 0, scale: 1.035 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.015 }}
                      transition={pageTransition}
                    />
                  ) : (
                    <m.div
                      key="controller-store-hero-placeholder"
                      className="controller-hero-placeholder"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={pageTransition}
                    />
                  )}
                </AnimatePresence>
                <div className="controller-hero-scrim" />
                <AnimatePresence initial={false} mode="wait">
                  <m.div
                    key={heroGame.id}
                    className="controller-hero-content"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={pageTransition}
                  >
                    {heroLogoUrl ? <img src={heroLogoUrl} alt={heroGame.title} className="controller-hero-logo" /> : <h1>{heroGame.title}</h1>}
                    <p className="controller-store-hero-meta">
                      {getPrimaryStoreName(heroGame, t, heroSelectedVariantId)}
                      {(() => {
                        const genre = getPrimaryGenre(heroGame, t);
                        return genre ? <>{` / ${genre}`}</> : null;
                      })()}
                    </p>
                    <div className="controller-hero-actions">
                      <button
                        type="button"
                        className="controller-primary-action"
                        onClick={() => {
                          if (heroNeedsOwnership) {
                            (onMarkGameOwned ?? onBuyGame)?.(heroGame, heroSelectedVariantId);
                            return;
                          }
                          onPlayGame(heroGame);
                        }}
                        disabled={heroMarkingOwned}
                      >
                        {heroNeedsOwnership
                          ? (heroMarkingOwned ? t("app.status.markingOwned") : t("app.actions.markAsOwned"))
                          : t("app.actions.play")}
                      </button>
                      <span className="controller-store-hero-pill">{getPrimaryStoreName(heroGame, t, heroSelectedVariantId)}</span>
                    </div>
                  </m.div>
                </AnimatePresence>
              </section>
            )}

            {heroGame && (
              <div className="controller-hero-dots" aria-hidden="true">
                {Array.from({ length: heroDotCount }).map((_, index) => (
                  <span key={index} className={index === activeHeroDotIndex ? "active" : ""} />
                ))}
              </div>
            )}

            <div className="controller-store-sections">
              {controllerSections.map((section, rowIndex) => (
                <section key={`${section.id}-${rowIndex}`} className="controller-store-section">
                  <div className="controller-store-section-heading">
                    <span>{String(rowIndex + 1).padStart(2, "0")}</span>
                    <h2>{section.title || t("home.controller.featured")}</h2>
                    <p>{t("library.gameCount", { count: section.games.length })}</p>
                  </div>
                  <div
                    className="controller-store-row"
                    ref={(element) => { rowRefs.current[rowIndex] = element; }}
                    data-controller-store-row={rowIndex}
                  >
                    {section.games.slice(0, 18).map((game, columnIndex) => {
                      const focused = rowIndex === focusedRowIndex && columnIndex === focusedColumnIndex;
                      const selectedVariantId = selectedVariantByGameId[game.id];
                      const selectedVariant = getSelectedVariant(game, selectedVariantId);
                      return (
                        <div key={game.id} className="controller-store-card" data-controller-store-column={columnIndex}>
                          <ControllerStoreTile
                            game={game}
                            selectedVariantId={selectedVariantId}
                            isMarkingOwned={Boolean(selectedVariant?.id && markOwnedInFlightByVariantId[selectedVariant.id])}
                            focused={focused}
                            onFocus={() => {
                              focusTile(rowIndex, columnIndex);
                              if (game.variants.length > 0) onSelectGameVariant(game.id, selectedVariantId ?? game.variants[game.selectedVariantIndex]?.id ?? game.variants[0].id);
                            }}
                            onMarkOwned={() => (onMarkGameOwned ?? onBuyGame)?.(game, selectedVariantId)}
                            onPlay={() => onPlayGame(game)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="controller-bottom-hints" aria-hidden="true">
              <div className="controller-hint"><span className="controller-button controller-button--a">A</span><span>{t("app.actions.select")}</span></div>
              <div className="controller-hint"><span className="controller-button controller-button--b">B</span><span>{t("app.actions.back")}</span></div>
              <div className="controller-hint"><span className="controller-button controller-button--x">X</span><span>{t("app.actions.search")}</span></div>
              <div className="controller-hint controller-hint--more"><span className="controller-menu-button"><Menu size={22} /></span><span>{t("library.moreOptions")}</span></div>
            </div>

            <AnimatePresence initial={false}>
              {controllerSearchOpen && (
                <m.div
                  className="controller-search-overlay"
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("app.actions.search")}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={pageTransition}
                >
                  <m.div
                    className="controller-search-panel"
                    initial={{ opacity: 0, y: 16, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.99 }}
                    transition={panelSpring}
                  >
                  <span className="controller-search-eyebrow">{t("app.actions.search")}</span>
                  <input
                    ref={controllerSearchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder={t("home.searchPlaceholder")}
                    className="controller-search-input"
                  />
                  <p>{t("app.actions.back")}</p>
                  </m.div>
                </m.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    );
  }

  const hasGames = games.length > 0;
  const showInitialLoading = isLoading && !hasGames;
  const visibleFilterGroups = filterGroups.filter((group) => ["digital_store", "genre", "subscriptions"].includes(group.id));
  const activeFilterCount = selectedFilterIds.length;
  const countLabel = showInitialLoading
    ? t("home.count.loading")
    : totalCount > games.length && supportedCount > 0
      ? t("home.count.shownTotalSupported", { shown: games.length, total: totalCount, supported: supportedCount })
      : totalCount > games.length
        ? t("home.count.shownTotal", { shown: games.length, total: totalCount })
        : supportedCount > 0
          ? t("home.count.shownSupported", { shown: games.length, supported: supportedCount })
          : t("home.count.shown", { shown: games.length });

  return (
    <div className="home-page">
      {continueGame && !showHero && (
        <div className="home-continue-card">
          {continueGame.imageUrl ? (
            <img
              className="home-continue-art"
              src={continueGame.imageUrl}
              alt=""
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <div className="home-continue-info">
            <span className="home-continue-kicker">{t("home.continuePlaying.kicker")}</span>
            <span className="home-continue-title">{continueGame.title}</span>
            <span className="home-continue-meta">
              {formatCatalogLastPlayed(t, new Date(gameActivityTimestamp(continueGame, playtimeData)).toISOString())}
            </span>
          </div>
          <button
            type="button"
            className="home-continue-play"
            onClick={() => onPlayGame(continueGame)}
          >
            <Play size={16} />
            {t("home.continuePlaying.play")}
          </button>
        </div>
      )}
      <header className="home-toolbar">
        <div className="home-search">
          <Search className="home-search-icon" size={16} />
          <input
            data-global-search="home"
            type="text"
            className="home-search-input"
            placeholder={t("home.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="home-search-clear"
              onClick={() => onSearchChange("")}
              aria-label={t("home.search.clear")}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {visibleFilterGroups.length > 0 && (
          <details className="home-filter-dropdown">
            <summary className="home-filter-dropdown-trigger">
              <span className="home-filter-dropdown-label">
                <Filter size={14} />
                {t("home.filters")}
              </span>
              {activeFilterCount > 0 && <span className="home-filter-dropdown-count">{activeFilterCount}</span>}
              <ChevronDown size={14} className="home-filter-dropdown-chevron" />
            </summary>
            <div className="home-filter-dropdown-menu">
              {visibleFilterGroups.map((group) => (
                <div key={group.id} className="home-filter-dropdown-group">
                  <div className="home-filter-group-label">{group.label}</div>
                  <div className="home-filter-chips">
                    {group.options.slice(0, group.id === "genre" ? 8 : group.options.length).map((option) => {
                      const active = selectedFilterIds.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`home-filter-chip ${active ? "active" : ""}`}
                          onClick={() => onToggleFilter(option.id)}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {activeFilterCount > 0 && (
                <button type="button" className="home-clear-filters" onClick={onClearFilters}>
                  {t("library.clearFilters")}
                </button>
              )}
            </div>
          </details>
        )}

        {sortOptions.length > 0 && (
          <div className="home-sort">
            <ArrowUpDown size={14} />
            <SelectDropdown
              value={selectedSortId}
              options={sortOptions.map((option) => ({ value: option.id, label: option.label }))}
              onChange={onSortChange}
              disabled={showInitialLoading}
              ariaLabel={t("home.sortAriaLabel")}
            />
          </div>
        )}

        <span className="home-count">
          {countLabel}
        </span>
      </header>

      <div className="home-grid-area">
        {showHeroPlaceholder && (
          // Same box as `.home-hero`, so the rail and grid below stay put when
          // the real hero replaces it.
          <section
            className="home-hero home-hero-skeleton"
            aria-hidden="true"
            data-hero-placeholder="true"
          >
            <div className="home-hero-skeleton-shine" />
            <div className="home-hero-skeleton-body">
              <span className="home-hero-skeleton-logo" />
              <span className="home-hero-skeleton-line" />
              <span className="home-hero-skeleton-line home-hero-skeleton-line--short" />
              <span className="home-hero-skeleton-actions" />
            </div>
          </section>
        )}
        {showHero && (() => {
          const slide = heroSlides[safeHeroIndex];
          if (!slide) return null;
          const heroImage = getControllerStoreImageCandidates(slide.game, true)[0] ?? slide.game.imageUrl;
          const heroLogo = getControllerStoreLogoUrl(slide.game);
          const heroStore = getPrimaryStoreName(slide.game, t, selectedVariantByGameId[slide.game.id]);
          return (
            <section
              className="home-hero"
              aria-roledescription="carousel"
              aria-label={t("home.hero.carouselLabel")}
              onMouseEnter={() => setHeroPaused(true)}
              onMouseLeave={() => setHeroPaused(false)}
            >
              <AnimatePresence initial={false}>
                <m.div
                  key={slide.game.id}
                  className="home-hero-slide"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                >
                  {heroImage && (
                    <img
                      className="home-hero-bg"
                      src={heroImage}
                      alt=""
                      draggable={false}
                      // The hero is the first thing on the page: decode it
                      // eagerly and at high priority so inserting the slide is
                      // not followed by another visible wait for the artwork.
                      loading="eager"
                      decoding="async"
                      fetchPriority="high"
                      onError={(event) => {
                        // Dead CDN URLs must not show a broken-image glyph in
                        // the hero; the gradient scrim alone still looks fine.
                        event.currentTarget.style.visibility = "hidden";
                      }}
                    />
                  )}
                  <div className="home-hero-scrim" />
                  <div className="home-hero-content">
                    {slide.isResume && (
                      <span className="home-hero-kicker">{t("home.continuePlaying.kicker")}</span>
                    )}
                    {heroLogo ? (
                      <img
                        className="home-hero-logo"
                        src={heroLogo}
                        alt={slide.game.title}
                        draggable={false}
                        onError={(event) => {
                          event.currentTarget.style.visibility = "hidden";
                        }}
                      />
                    ) : (
                      <h1 className="home-hero-title">{slide.game.title}</h1>
                    )}
                    <div className="home-hero-meta">
                      {(() => {
                        const genre = getPrimaryGenre(slide.game, t);
                        return genre ? <span className="home-hero-chip">{genre}</span> : null;
                      })()}
                      <span className="home-hero-chip">{heroStore}</span>
                      {slide.isResume && (() => {
                        const lastPlayedMs = gameActivityTimestamp(slide.game, playtimeData);
                        return lastPlayedMs > 0
                          ? <span className="home-hero-chip">{formatCatalogLastPlayed(t, new Date(lastPlayedMs).toISOString())}</span>
                          : null;
                      })()}
                    </div>
                    <div className="home-hero-actions">
                      <button
                        type="button"
                        className="home-hero-play"
                        onClick={() => onPlayGame(slide.game)}
                      >
                        <Play size={17} />
                        {slide.isResume ? t("home.hero.resume") : t("home.hero.play")}
                      </button>
                      <button
                        type="button"
                        className="home-hero-details"
                        onClick={() => setDetailsGame(slide.game)}
                      >
                        {t("home.hero.details")}
                      </button>
                    </div>
                  </div>
                </m.div>
              </AnimatePresence>
              {heroSlides.length > 1 && (
                <div className="home-hero-dots" role="tablist" aria-label={t("home.hero.carouselLabel")}>
                  {heroSlides.map((entry, index) => (
                    <button
                      key={entry.game.id}
                      type="button"
                      role="tab"
                      aria-selected={index === safeHeroIndex}
                      aria-label={t("home.hero.dotLabel", { index: index + 1 })}
                      className={`home-hero-dot ${index === safeHeroIndex ? "active" : ""}`}
                      onClick={() => setHeroIndex(index)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })()}

        {recentActivity.length > 0 && (
          <ContinuePlayingRail
            entries={recentActivity}
            onPlay={onPlayGame}
            onDetails={setDetailsGame}
          />
        )}

        {games.some((game) => favoriteGameIds.includes(game.id)) && (
          <section className="home-row home-favorites-row">
            <h2 className="home-section-title">
              <span className="home-section-bar" aria-hidden="true" />
              <Heart size={17} aria-hidden="true" />
              {t("home.favorites")}
            </h2>
            <div className="home-row-scroller">
              {games.filter((game) => favoriteGameIds.includes(game.id)).slice(0, 18).map((game) => (
                <div key={game.id} className="home-row-item">
                  <GameCardListItem
                    game={game}
                    isSelected={game.id === selectedGameId}
                    isFavorite
                    selectedVariantId={selectedVariantByGameId[game.id]}
                    actionsRef={catalogActionsRef}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {homeRows.map((section, sectionIndex) => (
          <section key={`${section.id}-${sectionIndex}`} className="home-row">
            <h2 className="home-section-title">
              <span className="home-section-bar" aria-hidden="true" />
              {section.title}
            </h2>
            <div className="home-row-scroller">
              {section.games.slice(0, 18).map((game) => (
                <div key={game.id} className="home-row-item">
                  <GameCardListItem
                    game={game}
                    isSelected={game.id === selectedGameId}
                    isFavorite={favoriteGameIds.includes(game.id)}
                    selectedVariantId={selectedVariantByGameId[game.id]}
                    actionsRef={catalogActionsRef}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}

        {!showInitialLoading && hasGames && (
          <div className="home-section-head">
            <h2 className="home-section-title">
              <span className="home-section-bar" aria-hidden="true" />
              {t("home.allGames")}
            </h2>
          </div>
        )}

        {showInitialLoading ? (
          <div className="game-grid" aria-busy="true" aria-label={t("common.loading")}>
            {Array.from({ length: 12 }, (_, index) => (
              <div key={index} className="home-skeleton-card">
                <div className="home-skeleton-poster" />
                <div className="home-skeleton-line" />
              </div>
            ))}
          </div>
        ) : !hasGames ? (
          <div className="home-empty-state">
            <LayoutGrid size={44} className="home-empty-icon" />
            <h3>{t("home.empty.noGamesFound")}</h3>
            <p>
              {searchQuery || selectedFilterIds.length > 0
                ? t("home.empty.tryAdjustingSearch")
                : t("home.empty.checkBackLater")}
            </p>
            {(searchQuery || selectedFilterIds.length > 0) && (
              <button
                type="button"
                className="home-empty-reset"
                onClick={() => {
                  onSearchChange("");
                  onClearFilters();
                }}
              >
                {t("library.clearFilters")}
              </button>
            )}
          </div>
        ) : (
          <div className="game-grid">
            {gameGridItems}
          </div>
        )}
      </div>
      {detailsGame && (
        <GameDetailsModal
          game={detailsGame}
          isFavorite={favoriteGameIds.includes(detailsGame.id)}
          onToggleFavorite={() => onToggleFavorite(detailsGame)}
          onPlay={() => onPlayGame(detailsGame)}
          onClose={() => setDetailsGame(null)}
        />
      )}
    </div>
  );
});
