/**
 * Translate raw GeForce NOW enum values into Japanese labels.
 *
 * The catalog payload carries machine enums (`playType: "FREE_TO_PLAY"`,
 * `gfnStatus: "UNAVAILABLE"`, `supportedControls: ["keyboard"]`,
 * `playabilityState: "PLAYABLE"` …) and several call sites used to print them
 * straight into the UI — the hero chip showed `FREE_TO_PLAY`, the store name
 * fell back to `Unknown` and the details modal's kicker could read
 * `INSTALL_TO_PLAY`.
 *
 * Everything here returns `null` when it does not recognise a value, so the
 * caller can decide on a fallback instead of showing a half-formatted enum.
 */

export type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

/** `FREE_TO_PLAY` → `free_to_play`; the lookup key for every enum table. */
function words(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/** `free_to_play` → `free to play`; a readable last resort for unknown enums. */
function readableWords(value: string): string {
  return words(value).replace(/_/g, " ");
}

/** Known `gfn.playType` values. Preserve the marketing distinction in Japanese. */
const PLAY_TYPE_KEYS: Record<string, string> = {
  free_to_play: "library.playType.freeToPlay",
  free: "library.playType.freeToPlay",
  "free_to_play_game": "library.playType.freeToPlay",
  install_to_play: "library.playType.installToPlay",
  install: "library.playType.installToPlay",
  "install_to_play_game": "library.playType.installToPlay",
  ready_to_play: "library.playType.readyToPlay",
  instant: "library.playType.readyToPlay",
  "stream_to_play": "library.playType.readyToPlay",
  cloud: "library.playType.readyToPlay",
  "cloud_game": "library.playType.readyToPlay",
  premium: "library.playType.premium",
  subscription: "library.playType.subscription",
  "subscription_required": "library.playType.subscription",
};

/**
 * `playType` as a display label.
 *
 * `FREE_TO_PLAY` must not collapse into `READY_TO_PLAY`: the first says the title
 * costs nothing, the second only says NVIDIA hosts it. Both stay distinguishable.
 */
export function playTypeLabel(playType: string | undefined, t: TranslateFn): string | null {
  if (!playType?.trim()) return null;
  const key = PLAY_TYPE_KEYS[words(playType)];
  if (key) return t(key);
  // Unknown enum: keep it readable rather than shouting in caps.
  const readable = readableWords(playType);
  return readable ? readable : null;
}

/** Filter-chip label for a `playType` value (same wording as {@link playTypeLabel}). */
export function playTypeFilterLabel(playType: string | undefined, t: TranslateFn): string | null {
  return playTypeLabel(playType, t);
}

const PLAYABILITY_KEYS: Record<string, string> = {
  playable: "library.playability.playable",
  available: "library.playability.available",
  unavailable: "library.playability.unavailable",
  maintenance: "library.playability.maintenance",
  not_available: "library.playability.unavailable",
  coming_soon: "library.playability.comingSoon",
};

/** `gfn.playabilityState` as a display label, or null when it adds nothing. */
export function playabilityStateLabel(state: string | undefined, t: TranslateFn): string | null {
  if (!state?.trim()) return null;
  const key = PLAYABILITY_KEYS[words(state)];
  return key ? t(key) : null;
}

const CONTROL_KEYS: Record<string, string> = {
  keyboard: "library.controlLabels.keyboard",
  mouse: "library.controlLabels.mouse",
  keyboard_mouse: "library.controlLabels.keyboardMouse",
  gamepad: "library.controlLabels.gamepad",
  controller: "library.controlLabels.gamepad",
  touch: "library.controlLabels.touch",
  touchscreen: "library.controlLabels.touch",
};

export function controlLabel(control: string, t: TranslateFn): string | null {
  const key = CONTROL_KEYS[words(control)];
  return key ? t(key) : null;
}

/**
 * Last-resort store name.
 *
 * `inferPublicGameStore` returns `Unknown` when NVIDIA sends neither a store nor
 * a publisher it can recognise, and `getStoreDisplayName` prefixes it into
 * `Unknown ストア` on every card. `未知のストア` says the same thing in Japanese.
 */
export function unknownStoreLabel(t: TranslateFn): string {
  return t("gameCard.unknownStore");
}

/** Whether a store value is the server-side "we could not work it out" placeholder. */
export function isUnknownStore(store: string | undefined): boolean {
  if (!store) return true;
  const key = store.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return key === "UNKNOWN" || key === "UNRECOGNIZED" || key === "";
}

/**
 * Known catalogue genre values.
 *
 * The catalogue is requested with `locale: ja_JP`, so most genres already come
 * back in Japanese and pass straight through. This table covers the payloads
 * that still arrive as English genre names, so a details panel never mixes
 * `アクション` with `Action`.
 */
const GENRE_KEYS: Record<string, string> = {
  action: "library.genreLabels.action",
  adventure: "library.genreLabels.adventure",
  arcade: "library.genreLabels.arcade",
  battle_royale: "library.genreLabels.battleRoyale",
  card: "library.genreLabels.card",
  casual: "library.genreLabels.casual",
  family: "library.genreLabels.family",
  fighting: "library.genreLabels.fighting",
  first_person_shooter: "library.genreLabels.shooter",
  fps: "library.genreLabels.shooter",
  horror: "library.genreLabels.horror",
  indie: "library.genreLabels.indie",
  metroidvania: "library.genreLabels.metroidvania",
  moba: "library.genreLabels.moba",
  mmo: "library.genreLabels.mmo",
  mmorpg: "library.genreLabels.mmo",
  music: "library.genreLabels.music",
  open_world: "library.genreLabels.openWorld",
  party: "library.genreLabels.party",
  platformer: "library.genreLabels.platformer",
  puzzle: "library.genreLabels.puzzle",
  racing: "library.genreLabels.racing",
  rhythm: "library.genreLabels.music",
  roguelike: "library.genreLabels.roguelike",
  role_playing_game: "library.genreLabels.rpg",
  rpg: "library.genreLabels.rpg",
  sandbox: "library.genreLabels.sandbox",
  shooter: "library.genreLabels.shooter",
  simulation: "library.genreLabels.simulation",
  sports: "library.genreLabels.sports",
  stealth: "library.genreLabels.stealth",
  strategy: "library.genreLabels.strategy",
  survival: "library.genreLabels.survival",
  third_person_shooter: "library.genreLabels.shooter",
  tower_defense: "library.genreLabels.towerDefense",
  visual_novel: "library.genreLabels.visualNovel",
};

/** Latin letters only: anything else is already localised by the catalogue. */
const HAS_LATIN = /[A-Za-z]/;

/**
 * `genres` as a display label.
 *
 * Already-localised values are returned untouched; an English genre is
 * translated when known, and dropped when it is not, rather than printed as an
 * English chip inside the Japanese UI.
 */
export function genreLabel(genre: string | undefined, t: TranslateFn): string | null {
  const value = genre?.trim();
  if (!value) return null;
  if (!HAS_LATIN.test(value)) return value;
  const key = GENRE_KEYS[words(value)];
  return key ? t(key) : null;
}

/**
 * NVIDIA technology / feature tags.
 *
 * `nvidiaTech` arrives as screaming-case enums (`PHOTO_MODE`, `FREESTYLE`), and
 * those used to be rendered verbatim in the details panel.
 */
const NVIDIA_TECH_KEYS: Record<string, string> = {
  dlss: "library.techLabels.dlss",
  freestyle: "library.techLabels.freestyle",
  gsync: "library.techLabels.gsync",
  hdr: "library.techLabels.hdr",
  highlights: "library.techLabels.highlights",
  photo_mode: "library.techLabels.photoMode",
  reflex: "library.techLabels.reflex",
  rtx: "library.techLabels.rtx",
};

export function nvidiaTechLabel(tech: string | undefined, t: TranslateFn): string | null {
  const value = tech?.trim();
  if (!value) return null;
  const key = NVIDIA_TECH_KEYS[words(value)];
  if (key) return t(key);
  // Unknown technology tags are marketing names more often than not; a readable
  // form beats an uppercase enum, and a non-Latin value is already localised.
  if (!HAS_LATIN.test(value)) return value;
  const readable = readableWords(value);
  return readable ? readable.replace(/\b\w/g, (letter) => letter.toUpperCase()) : null;
}

/** Known `membershipTier` values (GeForce NOW plan names are product names). */
const MEMBERSHIP_TIER_KEYS: Record<string, string> = {
  free: "app.labels.free",
  priority: "app.labels.priority",
  performance: "app.labels.priority",
  ultimate: "app.labels.ultimate",
};

/** `membershipTier` as a display label; unknown tiers stay readable, not shouting. */
export function membershipTierLabel(tier: string | undefined, t: TranslateFn): string | null {
  if (!tier?.trim()) return null;
  const key = MEMBERSHIP_TIER_KEYS[words(tier)];
  if (key) return t(key);
  return readableWords(tier) || null;
}

/**
 * `subscriptionType` / `subscriptionSubType` / `state` as a display label.
 *
 * The playtime modal printed these raw (`MEMBERSHIP`, `UNLIMITED`, `INACTIVE`),
 * which is the same class of leak as `FREE_TO_PLAY`. Values not in the table fall
 * back to a lowercase phrase so an unknown token never arrives in caps.
 */
const SUBSCRIPTION_FIELD_KEYS: Record<string, string> = {
  membership: "navbar.subscriptionValue.membership",
  "membership_plan": "navbar.subscriptionValue.membership",
  subscription: "navbar.subscriptionValue.subscription",
  time_based: "navbar.subscriptionValue.timeBased",
  unlimited: "app.labels.unlimited",
  active: "navbar.subscriptionValue.active",
  inactive: "navbar.subscriptionValue.inactive",
  expired: "navbar.subscriptionValue.expired",
  suspended: "navbar.subscriptionValue.suspended",
  cancelled: "navbar.subscriptionValue.cancelled",
  canceled: "navbar.subscriptionValue.cancelled",
  pending: "navbar.subscriptionValue.pending",
  grace_period: "navbar.subscriptionValue.gracePeriod",
};

export function subscriptionValueLabel(value: string | undefined, t: TranslateFn): string | null {
  if (!value?.trim()) return null;
  const key = SUBSCRIPTION_FIELD_KEYS[words(value)];
  if (key) return t(key);
  return readableWords(value) || null;
}
