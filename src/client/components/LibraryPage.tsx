import { Library, Search, Clock, Gamepad2, ArrowUpDown, Filter, ChevronDown, X, Plus } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { AnimatePresence, m } from "motion/react";
import type { CatalogSortOption, GameInfo } from "@shared/gfn";
import { GameCardListItem, useCatalogCardActionsRef } from "./GameCardListItem";
import { filterGamesByCollection, type GameCollection } from "../lib/collections";
import { GameDetailsModal } from "./GameDetailsModal";
import { HIDDEN_FILTER_ID, filterHiddenGames, toHiddenIdSet } from "../lib/hiddenGames";
import { isGameLockedForAccount, type GameAccessMap } from "../lib/gameAccess";
import { canAddFreeGameToLibrary } from "../lib/freeGames";
import type { PlaytimeData } from "../lib/gameCatalog";
import { formatTotalPlaytime, playtimeUnits, toFavoriteSet } from "../lib/localPreferences";
import { summarizeLibraryPlaytime } from "../lib/libraryPlaytimeSummary";
import { getControllerFeaturedGames } from "../lib/controllerCatalogUi";
import {
  gameMatchesLibraryFilters,
  gameMatchesStoreFilter,
  getControllerStoreFilterItems,
  getLibraryFilterGroups,
  getLibraryFilterOptionById,
  type ControllerStoreFilterItem,
  type LibraryFilterOption,
} from "../lib/libraryFilters";
import { useTranslation } from "../i18n";
import { formatCatalogLastPlayed } from "../utils/lastPlayedFormat";
import { gameActivityTimestamp } from "../lib/localPreferences";
import { controllerButton, readControllerGamepadButtons } from "../utils/controllerGamepad";
import { pageTransition } from "./MotionProvider";
import { SelectDropdown } from "./ui/SelectDropdown";
import { LibraryControllerView } from "./library/LibraryControllerView";
import { MotionSpinner } from "./MotionSpinner";

const CONTROLLER_HERO_ROTATION_MS = 8000;
const CONTROLLER_MOVE_REPEAT_MS = 140;
const CONTROLLER_Y_HOLD_MS = 350;

export interface LibraryPageProps {
  games: GameInfo[];
  allGames: GameInfo[];
  playtimeData: PlaytimeData;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onPlayGame: (game: GameInfo) => void;
  favoriteGameIds: string[];
  onToggleFavorite: (game: GameInfo) => void;
  /** Opens the store page that sells the selected variant (see `handleBuyGame`). */
  onBuyGame?: (game: GameInfo, selectedVariantId?: string) => void | Promise<void>;
  /** Adds a free-to-play title to the account's GFN library (no purchase). */
  onAddFreeGameToLibrary?: (game: GameInfo, selectedVariantId?: string) => void | Promise<void>;
  isLoading: boolean;
  selectedGameId: string;
  onSelectGame: (id: string) => void;
  selectedVariantByGameId: Record<string, string>;
  onSelectGameVariant: (gameId: string, variantId: string) => void;
  libraryCount: number;
  sortOptions: CatalogSortOption[];
  selectedSortId: string;
  onSortChange: (sortId: string) => void;
  controllerMode?: boolean;
  featuredGames?: GameInfo[];
  activeSessionAppIds?: number[];
  onPreviousControllerPage?: () => void;
  onNextControllerPage?: () => void;
  /** False when the page header already owns the search field. */
  showInlineSearch?: boolean;
  /** Local user collections and the one currently selected. */
  collections?: readonly GameCollection[];
  activeCollectionId?: string | null;
  onSelectCollection?: (collectionId: string | null) => void;
  onCreateCollection?: () => void;
  onRenameCollection?: (collection: GameCollection) => void;
  onDeleteCollection?: (collection: GameCollection) => void;
  /** Opens the tile context menu (details, collections, favourite). */
  onOpenGameMenu?: (game: GameInfo, event: { clientX: number; clientY: number }) => void;
  /** Ids of games hidden from the library grid. */
  hiddenGameIds?: string[];
  /** Hides or restores a game; the "Hidden" chip is how it comes back. */
  onToggleHidden?: (game: GameInfo) => void;
  /**
   * Per-game entitlement. Owned titles can still be gated by the membership
   * tier, and the grid must say so instead of offering a launch that fails.
   */
  gameAccess?: GameAccessMap;
}

export const LibraryPage = memo(function LibraryPage({
  games,
  allGames,
  playtimeData,
  searchQuery,
  onSearchChange,
  onPlayGame,
  favoriteGameIds,
  onToggleFavorite,
  onBuyGame,
  onAddFreeGameToLibrary,
  isLoading,
  selectedGameId,
  onSelectGame,
  selectedVariantByGameId,
  onSelectGameVariant,
  libraryCount,
  sortOptions,
  selectedSortId,
  onSortChange,
  controllerMode = false,
  featuredGames = [],
  activeSessionAppIds = [],
  onPreviousControllerPage,
  onNextControllerPage,
  showInlineSearch = true,
  collections = [],
  activeCollectionId = null,
  onSelectCollection,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onOpenGameMenu,
  hiddenGameIds = [],
  onToggleHidden,
  gameAccess,
}: LibraryPageProps): JSX.Element {
  const { t } = useTranslation();
  const [detailsGame, setDetailsGame] = useState<GameInfo | null>(null);
  const [buyPendingGameId, setBuyPendingGameId] = useState<string | null>(null);
  const [addPendingGameId, setAddPendingGameId] = useState<string | null>(null);
  const handleBuyFromDetails = async (target: GameInfo): Promise<void> => {
    if (!onBuyGame) return;
    setBuyPendingGameId(target.id);
    try {
      await onBuyGame(target, selectedVariantByGameId[target.id]);
    } finally {
      setBuyPendingGameId(null);
    }
  };
  const handleAddFromDetails = async (target: GameInfo): Promise<void> => {
    if (!onAddFreeGameToLibrary) return;
    setAddPendingGameId(target.id);
    try {
      await onAddFreeGameToLibrary(target, selectedVariantByGameId[target.id]);
    } finally {
      setAddPendingGameId(null);
    }
  };
  const catalogActionsRef = useCatalogCardActionsRef({
    onPlayGame,
    onToggleFavorite,
    onViewGameDetails: setDetailsGame,
    onSelectGame,
    onSelectGameVariant,
    onOpenGameMenu,
  });
  const [controllerHeroIndex, setControllerHeroIndex] = useState(0);
  const [controllerStoreFilterId, setControllerStoreFilterId] = useState("library");
  const [controllerStoreFilterOpen, setControllerStoreFilterOpen] = useState(false);
  const [controllerSearchOpen, setControllerSearchOpen] = useState(false);
  const [focusedControllerStoreFilterIndex, setFocusedControllerStoreFilterIndex] = useState(0);
  const [selectedLibraryFilterIds, setSelectedLibraryFilterIds] = useState<string[]>([]);
  const controllerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const gamepadPreviousButtonsRef = useRef(0);
  const gamepadLastMoveAtRef = useRef(0);
  const gamepadFrameRef = useRef<number | null>(null);
  const controllerYPressedAtRef = useRef(0);
  const controllerYConsumedByHoldRef = useRef(false);
  const controllerGameRowRef = useRef<HTMLDivElement | null>(null);
  const controllerInputStateRef = useRef({
    detailsGame: null as GameInfo | null,
    selectedControllerGame: undefined as GameInfo | undefined,
    selectedControllerGameIndex: 0,
    controllerStoreFilterOpen: false,
    focusedControllerStoreFilterIndex: 0,
    controllerStoreFilterItems: [] as ControllerStoreFilterItem[],
    focusControllerGame: (_index: number): void => {},
    cycleSelectedVariant: (): void => {},
    cycleControllerStoreFilter: (): void => {},
    moveControllerStoreFilterFocusBy: (_delta: number): void => {},
    hideControllerStoreFilterOverlay: (_applySelection: boolean): void => {},
    showControllerStoreFilterOverlay: (): void => {},
    onPlayGame: (_game: GameInfo): void => {},
  });

  useEffect(() => {
    if (!controllerMode || !controllerSearchOpen) return;
    controllerSearchInputRef.current?.focus();
  }, [controllerMode, controllerSearchOpen]);

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
      document.querySelector<HTMLInputElement>("[data-global-search='library']")?.focus();
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  const librarySearchHasQuery = searchQuery.trim().length > 0;
  const favoriteIdSet = useMemo(() => toFavoriteSet(favoriteGameIds), [favoriteGameIds]);
  const libraryFilterGroups = useMemo(
    () => getLibraryFilterGroups(allGames, playtimeData, t, favoriteGameIds, libraryCount),
    [allGames, favoriteGameIds, libraryCount, playtimeData, t],
  );
  // The first group is the desktop-style quick row (All / Ready / RTX /
  // Controller / stores); the rest stay in the dropdown.
  const quickFilterOptions = useMemo(() => {
    const options = libraryFilterGroups.find((group) => group.id === "quick")?.options ?? [];
    if (hiddenGameIds.length === 0) return options;
    return [
      ...options,
      { id: HIDDEN_FILTER_ID, label: t("library.filterOptions.hidden"), count: hiddenGameIds.length },
    ];
  }, [hiddenGameIds.length, libraryFilterGroups, t]);
  const secondaryFilterGroups = useMemo(
    () => libraryFilterGroups.filter((group) => group.id !== "quick"),
    [libraryFilterGroups],
  );
  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === activeCollectionId) ?? null,
    [activeCollectionId, collections],
  );
  const collectionScopedGames = useMemo(
    () => filterGamesByCollection(games, activeCollection),
    [activeCollection, games],
  );
  // "Hidden" is not a normal filter chip: it swaps the grid to the hidden games
  // instead of narrowing it, exactly like the desktop Library.
  const showingHiddenGames = selectedLibraryFilterIds.includes(HIDDEN_FILTER_ID);
  const hiddenIdSet = useMemo(() => toHiddenIdSet(hiddenGameIds), [hiddenGameIds]);
  const visibleLibraryGames = useMemo(
    () => filterHiddenGames(collectionScopedGames, hiddenGameIds, showingHiddenGames)
      .filter((game) => showingHiddenGames || gameMatchesLibraryFilters(game, selectedLibraryFilterIds, playtimeData, t, favoriteGameIds)),
    [collectionScopedGames, favoriteGameIds, hiddenGameIds, playtimeData, selectedLibraryFilterIds, showingHiddenGames, t],
  );
  const activeLibraryFilterOptions = useMemo(
    () => selectedLibraryFilterIds
      .map((filterId) => getLibraryFilterOptionById(libraryFilterGroups, filterId))
      .filter((option): option is LibraryFilterOption => Boolean(option)),
    [libraryFilterGroups, selectedLibraryFilterIds],
  );
  const hasActiveLibraryFilters = activeLibraryFilterOptions.length > 0;
  // One line the tiles cannot give: how much of the library has actually been
  // played, the running total, and which title took the most time. Built from
  // the same tracker as the per-tile numbers, over the games currently shown.
  const playtimeSummary = useMemo(
    () => summarizeLibraryPlaytime(visibleLibraryGames, playtimeData),
    [playtimeData, visibleLibraryGames],
  );
  const playtimeSummaryLine = playtimeSummary.totalSeconds > 0
    ? [
      t("library.playtimeSummary.total", {
        time: formatTotalPlaytime(playtimeSummary.totalSeconds, t("home.continuePlaying.neverPlayed"), playtimeUnits(t)),
      }),
      t("library.playtimeSummary.played", {
        played: playtimeSummary.playedGames,
        total: playtimeSummary.games,
      }),
      playtimeSummary.topGame
        ? t("library.playtimeSummary.top", {
          title: playtimeSummary.topGame.title,
          time: formatTotalPlaytime(playtimeSummary.topGameSeconds, t("home.continuePlaying.neverPlayed"), playtimeUnits(t)),
        })
        : null,
    ].filter((part): part is string => Boolean(part)).join(" · ")
    : null;

  const libraryCountLabel = hasActiveLibraryFilters || librarySearchHasQuery
    ? t("library.filteredGameCount", { shown: visibleLibraryGames.length, total: libraryCount, count: libraryCount })
    : t("library.gameCount", { count: libraryCount });

  useEffect(() => {
    const availableFilterIds = new Set(libraryFilterGroups.flatMap((group) => group.options.map((option) => option.id)));
    setSelectedLibraryFilterIds((previous) => {
      const next = previous.filter((filterId) => availableFilterIds.has(filterId));
      return next.length === previous.length ? previous : next;
    });
  }, [libraryFilterGroups]);

  useEffect(() => {
    if (controllerMode || visibleLibraryGames.length === 0) return;
    if (visibleLibraryGames.some((game) => game.id === selectedGameId)) return;
    onSelectGame(visibleLibraryGames[0].id);
  }, [controllerMode, onSelectGame, selectedGameId, visibleLibraryGames]);

  const toggleLibraryFilter = (filterId: string): void => {
    setSelectedLibraryFilterIds((previous) => (
      previous.includes(filterId)
        ? previous.filter((selectedFilterId) => selectedFilterId !== filterId)
        : [...previous, filterId]
    ));
  };

  const clearLibraryFilters = (): void => {
    setSelectedLibraryFilterIds([]);
  };

  const controllerStoreFilterItems = useMemo(
    () => getControllerStoreFilterItems(games, t("library.allStores"), t),
    [games, t],
  );
  const controllerGames = useMemo(
    () => controllerStoreFilterId === "library" ? games : games.filter((game) => gameMatchesStoreFilter(game, controllerStoreFilterId)),
    [controllerStoreFilterId, games],
  );
  const controllerFeaturedGames = useMemo(
    () => getControllerFeaturedGames(featuredGames, controllerGames),
    [featuredGames, controllerGames],
  );

  useEffect(() => {
    if (!controllerMode) return;
    setControllerHeroIndex(0);
  }, [controllerMode, controllerStoreFilterId, controllerFeaturedGames.length, controllerFeaturedGames[0]?.id]);

  useEffect(() => {
    if (controllerMode) return;
    gamepadPreviousButtonsRef.current = 0;
    gamepadLastMoveAtRef.current = 0;
  }, [controllerMode]);

  useEffect(() => {
    if (!controllerMode || controllerFeaturedGames.length <= 1) return;
    const interval = window.setInterval(() => {
      setControllerHeroIndex((index) => (index + 1) % controllerFeaturedGames.length);
    }, CONTROLLER_HERO_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [controllerMode, controllerFeaturedGames.length]);

  useEffect(() => {
    if (!controllerMode || games.length === 0) return;
    if (controllerGames.some((game) => game.id === selectedGameId)) return;
    onSelectGame(controllerGames[0]?.id ?? games[0].id);
  }, [controllerGames, controllerMode, games, onSelectGame, selectedGameId]);

  useEffect(() => {
    if (controllerStoreFilterItems.some((item) => item.id === controllerStoreFilterId)) return;
    setControllerStoreFilterId("library");
    setFocusedControllerStoreFilterIndex(0);
  }, [controllerStoreFilterId, controllerStoreFilterItems]);

  const selectedControllerGameIndex = Math.max(0, controllerGames.findIndex((game) => game.id === selectedGameId));
  const selectedControllerGame = controllerGames[selectedControllerGameIndex] ?? controllerGames[0];

  const focusControllerGame = (index: number): void => {
    if (controllerGames.length === 0) return;
    const nextIndex = Math.max(0, Math.min(index, controllerGames.length - 1));
    const nextGame = controllerGames[nextIndex];
    onSelectGame(nextGame.id);
    window.requestAnimationFrame(() => {
      const row = controllerGameRowRef.current;
      const card = row?.querySelector<HTMLElement>(`[data-controller-game-id="${CSS.escape(nextGame.id)}"]`);
      card?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "auto" });
    });
  };

  const cycleGameVariant = (game: GameInfo | undefined): void => {
    if (!game || game.variants.length <= 1) return;
    const activeVariantId = selectedVariantByGameId[game.id];
    const activeIndex = Math.max(0, game.variants.findIndex((variant) => variant.id === activeVariantId));
    const nextVariant = game.variants[(activeIndex + 1) % game.variants.length];
    if (nextVariant) onSelectGameVariant(game.id, nextVariant.id);
  };

  const cycleSelectedVariant = (): void => {
    cycleGameVariant(selectedControllerGame);
  };

  const cycleControllerStoreFilter = (): void => {
    if (controllerStoreFilterItems.length <= 1) return;
    const activeIndex = Math.max(0, controllerStoreFilterItems.findIndex((item) => item.id === controllerStoreFilterId));
    const nextItem = controllerStoreFilterItems[(activeIndex + 1) % controllerStoreFilterItems.length];
    setControllerStoreFilterId(nextItem.id);
    setFocusedControllerStoreFilterIndex((activeIndex + 1) % controllerStoreFilterItems.length);
    setControllerHeroIndex(0);
  };

  const showControllerStoreFilterOverlay = (): void => {
    const activeIndex = Math.max(0, controllerStoreFilterItems.findIndex((item) => item.id === controllerStoreFilterId));
    setFocusedControllerStoreFilterIndex(activeIndex);
    setControllerStoreFilterOpen(true);
  };

  const moveControllerStoreFilterFocusBy = (delta: number): void => {
    if (controllerStoreFilterItems.length === 0) return;
    setFocusedControllerStoreFilterIndex((index) => Math.max(0, Math.min(index + delta, controllerStoreFilterItems.length - 1)));
  };

  const hideControllerStoreFilterOverlay = (applySelection: boolean): void => {
    if (applySelection) {
      const item = controllerStoreFilterItems[focusedControllerStoreFilterIndex] ?? controllerStoreFilterItems[0];
      if (item) {
        setControllerStoreFilterId(item.id);
        setControllerHeroIndex(0);
      }
    }
    setControllerStoreFilterOpen(false);
  };

  // Keep the gamepad poller on a stable ref snapshot. Do not list the inline
  // helpers as effect deps — they are recreated every render and only need to
  // be copied into the ref, not trigger another commit.
  controllerInputStateRef.current = {
    detailsGame,
    selectedControllerGame,
    selectedControllerGameIndex,
    controllerStoreFilterOpen,
    focusedControllerStoreFilterIndex,
    controllerStoreFilterItems,
    focusControllerGame,
    cycleSelectedVariant,
    cycleControllerStoreFilter,
    moveControllerStoreFilterFocusBy,
    hideControllerStoreFilterOverlay,
    showControllerStoreFilterOverlay,
    onPlayGame,
  };

  useEffect(() => {
    if (!controllerMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (detailsGame) {
        if (event.key === "Escape" || event.key.toLowerCase() === "b") {
          event.preventDefault();
          setDetailsGame(null);
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlayGame(detailsGame);
        }
        return;
      }
      if (controllerSearchOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setControllerSearchOpen(false);
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusControllerGame(selectedControllerGameIndex - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        focusControllerGame(selectedControllerGameIndex + 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        cycleSelectedVariant();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (selectedControllerGame) onPlayGame(selectedControllerGame);
      } else if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        setControllerSearchOpen(true);
      } else if (event.key.toLowerCase() === "b" || event.key === "Escape") {
        event.preventDefault();
        onPreviousControllerPage?.();
      } else if (event.key === "[") {
        event.preventDefault();
        onPreviousControllerPage?.();
      } else if (event.key === "]") {
        event.preventDefault();
        onNextControllerPage?.();
      } else if (event.key.toLowerCase() === "i" || event.key.toLowerCase() === "m") {
        event.preventDefault();
        if (selectedControllerGame) setDetailsGame(selectedControllerGame);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controllerMode, controllerSearchOpen, detailsGame, onNextControllerPage, onPlayGame, onPreviousControllerPage, selectedControllerGame, selectedControllerGameIndex]);

  useEffect(() => {
    if (!controllerMode) return;
    const readButtons = (): number => {
      const pad = navigator.getGamepads?.().find((gamepad): gamepad is Gamepad => Boolean(gamepad));
      return readControllerGamepadButtons(pad);
    };

    const handleGamepadFrame = () => {
      const buttons = readButtons();
      let pressed = buttons & ~gamepadPreviousButtonsRef.current;
      const released = gamepadPreviousButtonsRef.current & ~buttons;
      const moveMask = controllerButton.up | controllerButton.down | controllerButton.left | controllerButton.right;
      const yButton = controllerButton.north;
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
        detailsGame: currentDetailsGame,
        selectedControllerGame: currentSelectedGame,
        selectedControllerGameIndex: currentSelectedIndex,
        controllerStoreFilterOpen: storeFilterOpen,
        focusControllerGame: focusGame,
        cycleSelectedVariant: cycleVariant,
        cycleControllerStoreFilter: cycleStoreFilter,
        moveControllerStoreFilterFocusBy: moveStoreFilter,
        hideControllerStoreFilterOverlay: hideStoreFilter,
        showControllerStoreFilterOverlay: showStoreFilter,
        onPlayGame: playGame,
      } = controllerInputStateRef.current;

      if (pressed & yButton) {
        controllerYPressedAtRef.current = now;
        controllerYConsumedByHoldRef.current = false;
      }

      if ((buttons & yButton) && !controllerYConsumedByHoldRef.current && now - controllerYPressedAtRef.current >= CONTROLLER_Y_HOLD_MS) {
        controllerYConsumedByHoldRef.current = true;
        showStoreFilter();
      }

      if (controllerSearchOpen) {
        if (pressed & controllerButton.east) setControllerSearchOpen(false);
        gamepadPreviousButtonsRef.current = buttons;
        gamepadFrameRef.current = window.requestAnimationFrame(handleGamepadFrame);
        return;
      }

      if (storeFilterOpen) {
        if (pressed & controllerButton.up) moveStoreFilter(-1);
        if (pressed & controllerButton.down) moveStoreFilter(1);
        if (pressed & controllerButton.east) hideStoreFilter(false);
        if (released & yButton) hideStoreFilter(true);
        gamepadPreviousButtonsRef.current = buttons;
        gamepadFrameRef.current = window.requestAnimationFrame(handleGamepadFrame);
        return;
      }

      if (currentDetailsGame) {
        if (pressed & controllerButton.south) playGame(currentDetailsGame);
        if (pressed & controllerButton.east) setDetailsGame(null);
      } else {
        if ((released & yButton) && !controllerYConsumedByHoldRef.current) cycleStoreFilter();
        if (pressed & controllerButton.south) {
          if (currentSelectedGame) playGame(currentSelectedGame);
        }
        if (pressed & controllerButton.east) onPreviousControllerPage?.();
        if (pressed & controllerButton.west) setControllerSearchOpen(true);
        if (pressed & controllerButton.leftShoulder) onPreviousControllerPage?.();
        if (pressed & controllerButton.rightShoulder) onNextControllerPage?.();
        if (pressed & controllerButton.menu) {
          if (currentSelectedGame) setDetailsGame(currentSelectedGame);
        }
        if (pressed & controllerButton.left) focusGame(currentSelectedIndex - 1);
        if (pressed & controllerButton.right) focusGame(currentSelectedIndex + 1);
        if (pressed & controllerButton.down) cycleVariant();
      }
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

  const libraryGridItems = useMemo(
    () => visibleLibraryGames.map((game) => {
      const record = playtimeData[game.id];
      const isFavorite = favoriteIdSet.has(game.id);
      const totalPlaytime = record?.totalSeconds ?? 0;
      // Same source as the rail and the hero: newest of local tracker and
      // catalog. Reading only `game.lastPlayed` here made a game show
      // "3日前" in one column and "未プレイ" in the next.
      const lastPlayedMs = gameActivityTimestamp(game, playtimeData);
      return (
        <div
          key={game.id}
          className={`library-game-wrapper${isFavorite ? " is-favorite" : ""}${hiddenIdSet.has(game.id) ? " is-hidden-game" : ""}`}
        >
          {isFavorite && (
            <span className="library-favorite-pin" title={t("library.filterOptions.favorite")}>
              ★
            </span>
          )}
          <GameCardListItem
            game={game}
            isSelected={game.id === selectedGameId}
            isFavorite={isFavorite}
            selectedVariantId={selectedVariantByGameId[game.id]}
            access={gameAccess?.get(game.id)}
            actionsRef={catalogActionsRef}
          />
          <div
            className={`library-last-played${lastPlayedMs > 0 ? "" : " library-last-played--empty"}`}
            aria-hidden={lastPlayedMs > 0 ? undefined : true}
          >
            <Clock size={12} />
            <span>{lastPlayedMs > 0 ? formatCatalogLastPlayed(t, new Date(lastPlayedMs).toISOString()) : "—"}</span>
          </div>
          {totalPlaytime > 0 && (
            // One row only: the relative time already appears above, repeating
            // it next to the total made the card look inconsistent.
            <div className="library-playtime" title={t("library.totalPlaytime")}>
              <span>{formatTotalPlaytime(totalPlaytime, t("home.continuePlaying.neverPlayed"), playtimeUnits(t))}</span>
            </div>
          )}
        </div>
      );
    }),
    [catalogActionsRef, favoriteIdSet, gameAccess, hiddenIdSet, playtimeData, selectedGameId, selectedVariantByGameId, t, visibleLibraryGames],
  );

  if (controllerMode) {
    const featuredGame = controllerFeaturedGames[controllerHeroIndex] ?? selectedControllerGame;
    return (
      <LibraryControllerView
        isLoading={isLoading}
        libraryCount={libraryCount}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        selectedGameId={selectedGameId}
        onSelectGame={onSelectGame}
        onPlayGame={onPlayGame}
        onBuyGame={onBuyGame}
        selectedVariantByGameId={selectedVariantByGameId}
        activeSessionAppIds={activeSessionAppIds}
        featuredGame={featuredGame}
        controllerFeaturedGames={controllerFeaturedGames}
        controllerHeroIndex={controllerHeroIndex}
        controllerGames={controllerGames}
        controllerGameRowRef={controllerGameRowRef}
        controllerStoreFilterOpen={controllerStoreFilterOpen}
        controllerStoreFilterItems={controllerStoreFilterItems}
        focusedControllerStoreFilterIndex={focusedControllerStoreFilterIndex}
        onFocusControllerStoreFilter={setFocusedControllerStoreFilterIndex}
        onSelectControllerStoreFilter={(itemId) => {
          setControllerStoreFilterId(itemId);
          setControllerStoreFilterOpen(false);
        }}
        controllerSearchOpen={controllerSearchOpen}
        controllerSearchInputRef={controllerSearchInputRef}
        detailsGame={detailsGame}
        onCloseDetails={() => setDetailsGame(null)}
        onCycleGameVariant={cycleGameVariant}
      />
    );
  }

  return (
    <div className="library-page">
      <header className="library-toolbar">
        <div className="library-title">
          <Library className="library-title-icon" size={22} />
          <h1>{t("library.title")}</h1>
        </div>

        {showInlineSearch && (
        <div className="library-search">
          <Search className="library-search-icon" size={16} />
          <input
            data-global-search="library"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("library.searchPlaceholder")}
            className="library-search-input"
          />
        </div>
        )}

        {quickFilterOptions.length > 1 && (
          <div className="library-quick-filters" role="group" aria-label={t("library.filterGroups.quick")}>
            {quickFilterOptions.map((option) => {
              const active = selectedLibraryFilterIds.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`library-quick-chip${active ? " library-quick-chip--active" : ""}`}
                  onClick={() => toggleLibraryFilter(option.id)}
                  aria-pressed={active}
                >
                  <span>{option.label}</span>
                  <span className="library-quick-chip-count">{option.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {secondaryFilterGroups.length > 0 && (
          <details className="library-filter-dropdown">
            <summary className="library-filter-dropdown-trigger">
              <span className="library-filter-dropdown-label">
                <Filter size={14} />
                {t("library.filters")}
              </span>
              {selectedLibraryFilterIds.length > 0 && <span className="library-filter-dropdown-count">{selectedLibraryFilterIds.length}</span>}
              <ChevronDown size={14} className="library-filter-dropdown-chevron" />
            </summary>
            <div className="library-filter-dropdown-menu">
              {secondaryFilterGroups.map((group) => (
                <div key={group.id} className="library-filter-dropdown-group">
                  <div className="library-filter-group-label">{group.label}</div>
                  <div className="library-filter-chips">
                    {group.options.map((option) => {
                      const active = selectedLibraryFilterIds.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`library-filter-chip ${active ? "active" : ""}`}
                          onClick={() => toggleLibraryFilter(option.id)}
                          aria-pressed={active}
                        >
                          <span>{option.label}</span>
                          <span className="library-filter-chip-count">{option.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {sortOptions.length > 0 && (
          <div className="library-sort">
            <ArrowUpDown size={14} />
            <SelectDropdown
              value={selectedSortId}
              options={sortOptions.map((option) => ({ value: option.id, label: option.label }))}
              onChange={onSortChange}
              ariaLabel={t("library.sortAriaLabel")}
            />
          </div>
        )}

        <span className="library-count">{libraryCountLabel}</span>
      </header>

      {playtimeSummaryLine && (
        <p className="library-playtime-summary">{playtimeSummaryLine}</p>
      )}

      {(collections.length > 0 || onCreateCollection) && (
        <div className="library-collection-bar">
          <div className="library-collection-chips" role="group" aria-label={t("collections.menuLabel")}>
            <button
              type="button"
              className={`library-collection-chip${activeCollectionId === null ? " library-collection-chip--active" : ""}`}
              onClick={() => onSelectCollection?.(null)}
              aria-pressed={activeCollectionId === null}
            >
              {t("collections.allGames")}
            </button>
            {collections.map((collection) => {
              const active = collection.id === activeCollectionId;
              return (
                <button
                  key={collection.id}
                  type="button"
                  className={`library-collection-chip${active ? " library-collection-chip--active" : ""}`}
                  onClick={() => onSelectCollection?.(active ? null : collection.id)}
                  onDoubleClick={() => onRenameCollection?.(collection)}
                  aria-pressed={active}
                  title={t("collections.rename")}
                >
                  {collection.name}
                  <span className="library-collection-chip-count">{collection.gameIds.length}</span>
                </button>
              );
            })}
            {onCreateCollection && (
              <button
                type="button"
                className="library-collection-add"
                onClick={onCreateCollection}
                title={t("collections.newCollection")}
                aria-label={t("collections.newCollection")}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          {activeCollection && (
            <div className="library-collection-actions">
              <button type="button" onClick={() => onRenameCollection?.(activeCollection)}>
                {t("collections.rename")}
              </button>
              <button type="button" className="library-collection-delete" onClick={() => onDeleteCollection?.(activeCollection)}>
                {t("collections.delete")}
              </button>
            </div>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {activeLibraryFilterOptions.length > 0 && (
          <m.div
            className="library-active-filters"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={pageTransition}
          >
            <span className="library-active-filter-label">{t("library.activeFilters")}</span>
            {activeLibraryFilterOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className="library-active-filter-chip"
                onClick={() => toggleLibraryFilter(option.id)}
                aria-label={t("library.removeFilter", { filter: option.label })}
              >
                <span>{option.label}</span>
                <X size={12} />
              </button>
            ))}
            <button type="button" className="library-clear-filters" onClick={clearLibraryFilters}>
              {t("library.clearFilters")}
            </button>
          </m.div>
        )}
      </AnimatePresence>

      <div className="library-grid-area">
        {isLoading ? (
          <div className="library-empty-state">
            <MotionSpinner className="library-spinner" size={36} label={t("common.loading")} />
            <p>{t("library.empty.loadingLibrary")}</p>
          </div>
        ) : libraryCount === 0 ? (
          <div className="library-empty-state">
            <Gamepad2 className="library-empty-icon" size={44} />
            <h3>{t("library.empty.libraryEmpty")}</h3>
            <p>{t("library.empty.ownedGamesAppearHere")}</p>
          </div>
        ) : visibleLibraryGames.length === 0 ? (
          <div className="library-empty-state">
            <Search className="library-empty-icon" size={44} />
            {showingHiddenGames && !librarySearchHasQuery ? (
              <>
                <h3>{t("library.empty.noHiddenGames")}</h3>
                <p>{t("library.hideGameHint")}</p>
              </>
            ) : activeCollection && !librarySearchHasQuery && !hasActiveLibraryFilters ? (
              <>
                <h3>{t("collections.emptyView")}</h3>
                <p>{t("collections.addHint")}</p>
              </>
            ) : (
              <>
                <h3>{hasActiveLibraryFilters && !librarySearchHasQuery ? t("library.empty.noFilteredGames") : t("library.empty.noGamesFound")}</h3>
                <p>
                  {librarySearchHasQuery
                    ? t("library.empty.noGamesMatch", { query: searchQuery })
                    : hasActiveLibraryFilters
                      ? t("library.empty.tryAdjustingFilters")
                      : t("library.empty.noGamesMatch", { query: searchQuery })}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="game-grid">
            {libraryGridItems}
          </div>
        )}
      </div>
      {detailsGame && (
        <GameDetailsModal
          game={detailsGame}
          isFavorite={favoriteGameIds.includes(detailsGame.id)}
          onToggleFavorite={() => onToggleFavorite(detailsGame)}
          onPlay={() => onPlayGame(detailsGame)}
          lockedReason={(() => {
            const access = gameAccess?.get(detailsGame.id);
            if (!access || !isGameLockedForAccount(access)) return null;
            return access.state === "tier-required"
              ? t("gameCard.tierRequiredHint", { tier: access.tierLabel ?? t("gameCard.tierRequiredFallback") })
              : t("gameCard.notOwnedHint");
          })()}
          onBuy={onBuyGame ? () => { void handleBuyFromDetails(detailsGame); } : undefined}
          isBuyPending={buyPendingGameId === detailsGame.id}
          onAddToLibrary={
            onAddFreeGameToLibrary && canAddFreeGameToLibrary(detailsGame, gameAccess?.get(detailsGame.id))
              ? () => { void handleAddFromDetails(detailsGame); }
              : undefined
          }
          isAddPending={addPendingGameId === detailsGame.id}
          onClose={() => setDetailsGame(null)}
        />
      )}
    </div>
  );
});
