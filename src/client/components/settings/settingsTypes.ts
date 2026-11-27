import type { JSX } from "react";

export type SettingsNavItem = {
  id: SettingsSectionId;
  label: string;
  icon: JSX.Element;
};

export type SettingsNavGroup = {
  label: string;
  items: SettingsNavItem[];
};

export type ThanksLoadState = "idle" | "loading" | "loaded" | "error";
export type StorageResetState = "idle" | "resetting" | "success" | "error";
export type GameAccountBusyAction = "link" | "unlink" | "resync";

export type SettingsSectionId =
  | "account"
  | "stores"
  | "subscription"
  | "recording"
  | "console"
  | "stream"
  | "game"
  | "audio"
  | "input"
  | "interface"
  | "updates"
  | "ai"
  | "about"
  | "thanks";
export type SettingsSearchScopeId =
  | "account-storage"
  | "stores"
  | "subscription"
  | "recording"
  | "console"
  | "stream-region"
  | "stream-video"
  | "stream-codec-diagnostics"
  | "game"
  | "audio"
  | "input"
  | "interface"
  | "updates"
  | "ai"
  | "about"
  | "thanks";

export const SETTINGS_SCOPE_SEARCH_TERMS: Record<SettingsSearchScopeId, readonly string[]> = {
  "account-storage": [
    "account",
    "subscription",
    "storage",
    "persistent storage",
    "cloud storage",
    "install to play",
    "reset storage",
    "storage reset",
    "connections",
    "connected accounts",
    "game accounts",
    "link accounts",
    "unlink accounts",
    "sync library",
    "steam",
    "epic",
    "ubisoft",
    "battle.net",
    "xbox",
    "gaijin",
    "region",
    "data",
    "games",
    "downloads",
    "available",
    "used",
  ],
  console: [
    "console",
    "console mode",
    "tv",
    "big picture",
    "gamepad",
    "controller",
    "shell",
    "startup",
  ],
  recording: [
    "recording",
    "record",
    "clip",
    "replay",
    "capture",
    "captures",
    "screenshot",
    "screenshots",
    "bitrate",
  ],
  stores: [
    "stores",
    "store",
    "connections",
    "connected accounts",
    "game accounts",
    "link accounts",
    "unlink accounts",
    "sync library",
    "steam",
    "epic",
    "gog",
    "ubisoft",
    "battle.net",
    "xbox",
    "gaijin",
  ],
  subscription: [
    "subscription",
    "membership",
    "plan",
    "tier",
    "entitlements",
    "hours",
    "ultimate",
    "priority",
    "unlimited",
  ],
  "stream-region": [
    "stream",
    "region",
    "notification",
    "queue notification",
    "sound",
    "chime",
    "adaptive bitrate",
    "auto quality",
    "bitrate",
    "latency",
    "ping",
    "server",
    "route",
    "auto best",
    "proxy",
    "vpn",
    "queue",
    "session",
    "sponsor",
    "github sponsor",
    "supporter",
  ],
  "stream-video": [
    "stream",
    "video",
    "quality",
    "codec",
    "fps",
    "resolution",
    "bitrate",
    "aspect ratio",
    "l4s",
    "cloud gsync",
    "console mode",
    "tv mode",
    "big picture",
    "gamepad friendly",
    "video acceleration",
    "filters",
    "shader",
    "shaders",
    "sharpen",
    "sharpening",
    "saturation",
    "contrast",
    "brightness",
    "vibrance",
    "film grain",
    "post processing",
    "session proxy",
    "community proxy",
    "zortos",
  ],
  "stream-codec-diagnostics": [
    "stream",
    "codec diagnostics",
    "diagnostics",
    "decode",
    "encode",
    "gpu",
    "cpu",
    "test codecs",
  ],
  game: ["game", "language", "keyboard layout", "store", "launch", "graphics settings", "in-game settings", "persistence", "hide unplayable", "not owned", "membership tier"],
  audio: ["audio", "microphone", "mic", "push to talk", "voice activity"],
  input: [
    "touch gamepad",
    "virtual controller",
    "touchscreen",
    "on-screen controls",
    "input",
    "mouse",
    "keyboard layout",
    "shortcut",
    "hotkey",
    "keybind",
    "controls",
    "controller",
    "gamepad",
    "gyro",
    "gyroscope",
    "steam",
    "steam controller",
    "xbox",
    "compatibility",
    "gamecontroller",
    "hid",
    "macos",
    "motion controls",
    "anti afk",
    "pointer lock",
    "native cursor",
    "cursor overlay",
    "server cursor",
    "server-side cursor",
    "recording",
    "screenshot",
  ],
  interface: [
    "interface",
    "ui",
    "language",
    "locale",
    "translation",
    "app language",
    "accent color",
    "theme color",
    "overlay",
    "library",
    "fullscreen",
    "discord",
    "rich presence",
    "poster",
    "session timer",
    "session time left",
    "session countdown",
    "free tier time",
    "priority time",
    "ultimate time",
    "counter",
    "controller",
    "gamepad",
    "big picture",
  ],
  ai: [
    "ai",
    "ai player",
    "auto play",
    "自動プレイ",
    "aiプレイヤー",
    "numes",
    "api key",
    "model",
  ],
  updates: [
    "updates",
    "update",
    "version",
    "release notes",
    "changelog",
    "channel",
    "stable",
    "nightly",
    "download",
    "install",
    "restart",
  ],
  about: [
    "about",
    "what's new",
    "release notes",
    "logs",
    "cache",
    "export",
    "delete",
    "diagnostics",
    "report",
    "redacted",
  ],
  thanks: ["thanks", "contributors", "supporters", "sponsors", "community"],
};

/**
 * Translated headings for each search scope.
 *
 * The English term lists above are what the desktop build's search knows; a
 * Japanese visitor types 「通信」「マイク」「テーマ」, which never appear there.
 * Searching the rendered section titles as well makes the search work in the
 * language the UI is actually in.
 */
/**
 * Settings rows whose label is matched on its own while searching. Matching a
 * whole section is coarse: 「隠す」 has to be able to point at the exact switch,
 * not just at the Game section that contains it.
 */
export const SEARCHABLE_SETTING_ROW_KEYS: readonly string[] = [
  "settings.game.hideUnplayable",
];

export const SETTINGS_SCOPE_LABEL_KEYS: Record<SettingsSearchScopeId, readonly string[]> = {
  "account-storage": ["settings.sections.account", "settings.accountConnections.title", "settings.persistentStorage.title", "settings.region.title"],
  "stream-region": ["settings.sections.stream", "settings.region.title", "settings.queueNotifications"],
  "stream-video": ["settings.sections.stream", "settings.video.title", "settings.videoFilters.title", "settings.video.resolution", "settings.video.colorDepth"],
  "stream-codec-diagnostics": ["settings.sections.stream", "settings.codecDiagnostics.title"],
  game: ["settings.sections.game", "settings.game.title"],
  audio: ["settings.sections.audio", "settings.audio.microphone"],
  input: ["settings.sections.input"],
  interface: ["settings.sections.interface", "settings.interface.appearance", "settings.interface.theme", "settings.interface.themePack", "settings.interface.accentColor"],
  ai: ["settings.sections.ai"],
  console: ["settings.sections.console", "settings.console.title"],
  recording: ["settings.sections.recording", "settings.recording.title"],
  stores: ["settings.sections.stores", "settings.accountConnections.title"],
  subscription: ["settings.sections.subscription", "settings.subscription.title"],
  updates: ["settings.sections.updates", "settings.updates.title"],
  about: ["settings.sections.about"],
  thanks: ["settings.sections.thanks"],
};
