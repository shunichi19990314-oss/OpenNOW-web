import type { AppAccentColor, ThemePackId } from "@shared/gfn";

/**
 * Colour packs ported from the desktop client's Paper design (opennow-qt
 * `qml/theme/Theme.qml`). Each pack ships a shell colour, a mid tone used to
 * derive panels/chips, and an accent; light-first packs also carry the dark
 * shell they fall back to when the app is in dark mode (and vice versa).
 *
 * Names are product words (Nocturne, Aurora …) and stay untranslated, exactly
 * as the desktop build shows them.
 */
export type ThemePackCategory = "dark" | "light" | "high-contrast";

export interface ThemePackDefinition {
  id: ThemePackId;
  name: string;
  /** Locale key for the descriptor printed under the name. */
  detailKey: string;
  category: ThemePackCategory;
  /** Dark-mode shell. */
  bg: string;
  /** Light-mode shell, when the pack lists one. */
  lightBg?: string;
  /** Dark-mode shell for light-first packs. */
  darkBg?: string;
  mid: string;
  accent: string;
  lightAccent?: string;
  darkAccent?: string;
}

export const THEME_PACKS: readonly ThemePackDefinition[] = [
  { id: "nocturne", name: "Nocturne", detailKey: "settings.interface.themePackDetailNocturne", category: "dark", bg: "#0B0F1A", lightBg: "#EEF3FA", mid: "#252A48", accent: "#7FD4FF", lightAccent: "#12638C" },
  { id: "aurora", name: "Aurora", detailKey: "settings.interface.themePackDetailAurora", category: "dark", bg: "#071A20", lightBg: "#EAF5F2", mid: "#16434A", accent: "#6EE7B7", lightAccent: "#126B4E" },
  { id: "kraft", name: "Kraft", detailKey: "settings.interface.themePackDetailKraft", category: "dark", bg: "#211D17", lightBg: "#F4ECDD", mid: "#756346", accent: "#D3A85C", lightAccent: "#796020" },
  { id: "phosphor", name: "Phosphor", detailKey: "settings.interface.themePackDetailPhosphor", category: "high-contrast", bg: "#07120B", lightBg: "#EDF8EA", mid: "#12351D", accent: "#6BFF8A", lightAccent: "#216C31" },
  { id: "bone", name: "Bone", detailKey: "settings.interface.themePackDetailBone", category: "light", bg: "#EEE7DB", darkBg: "#201D18", mid: "#A89578", accent: "#7F6A4D", darkAccent: "#D3BA91" },
  { id: "cobalt", name: "Cobalt", detailKey: "settings.interface.themePackDetailCobalt", category: "light", bg: "#F7F9FF", darkBg: "#0E1730", mid: "#ADC4FF", accent: "#245BDB", darkAccent: "#93B5FF" },
  { id: "hibiscus", name: "Hibiscus", detailKey: "settings.interface.themePackDetailHibiscus", category: "dark", bg: "#1F0C18", lightBg: "#FAEDF3", mid: "#642343", accent: "#FF6F9F", lightAccent: "#AA285B" },
  { id: "chapel", name: "Chapel", detailKey: "settings.interface.themePackDetailChapel", category: "dark", bg: "#151225", lightBg: "#F3EFF9", mid: "#40355D", accent: "#FFD166", lightAccent: "#806017" },
] as const;

export const DEFAULT_THEME_PACK: ThemePackId = "nocturne";

const THEME_PACK_MAP = new Map<ThemePackId, ThemePackDefinition>(
  THEME_PACKS.map((pack) => [pack.id, pack]),
);

export function getThemePack(id: ThemePackId | undefined): ThemePackDefinition {
  return (id && THEME_PACK_MAP.get(id)) || THEME_PACKS[0];
}

export function isKnownThemePackId(value: unknown): value is ThemePackId {
  return typeof value === "string" && THEME_PACK_MAP.has(value as ThemePackId);
}

export interface ThemePackPalette {
  /** Primary shell colour for the resolved mode. */
  shell: string;
  /** Mid tone between shell and its accents. */
  mid: string;
  /** Accent for the resolved mode. */
  accent: string;
  /** True when the resolved mode is the light appearance. */
  light: boolean;
}

/**
 * Resolve a pack for the current appearance. A dark-first pack keeps `bg` in
 * dark mode and swaps to `lightBg` in light mode; a light-first pack keeps its
 * paper shell in light mode and uses `darkBg` when dark.
 */
export function resolveThemePackPalette(pack: ThemePackDefinition, light: boolean): ThemePackPalette {
  const shell = light
    ? (pack.lightBg ?? pack.bg)
    : (pack.darkBg ?? pack.bg);
  const accent = light
    ? (pack.lightAccent ?? pack.accent)
    : (pack.darkAccent ?? pack.accent);
  return { shell, mid: pack.mid, accent, light };
}

/* ------------------------------------------------------------------ */
/* Accent colours                                                      */
/* ------------------------------------------------------------------ */

export interface AccentColorOption {
  value: AppAccentColor;
  labelKey: string;
  /** Dark-mode swatch. */
  hex: `#${string}`;
  /** Light-mode swatch; matches the desktop palette so contrast holds. */
  lightHex: `#${string}`;
}

export const ACCENT_COLOR_OPTIONS: readonly AccentColorOption[] = [
  { value: "green", labelKey: "settings.interface.accentColorGreen", hex: "#6EE7B7", lightHex: "#126B4E" },
  { value: "blue", labelKey: "settings.interface.accentColorBlue", hex: "#7FD4FF", lightHex: "#12638C" },
  { value: "violet", labelKey: "settings.interface.accentColorViolet", hex: "#A78BFA", lightHex: "#7042BA" },
  { value: "rose", labelKey: "settings.interface.accentColorRose", hex: "#FF8A9A", lightHex: "#AA285B" },
  { value: "coral", labelKey: "settings.interface.accentColorCoral", hex: "#FF8A80", lightHex: "#A9362C" },
  { value: "amber", labelKey: "settings.interface.accentColorAmber", hex: "#FFD166", lightHex: "#806017" },
  { value: "white", labelKey: "settings.interface.accentColorWhite", hex: "#FFFFFF", lightHex: "#374151" },
] as const;

const ACCENT_COLOR_MAP = new Map<AppAccentColor, AccentColorOption>(
  ACCENT_COLOR_OPTIONS.map((option) => [option.value, option]),
);

export function getAccentColorOptionFromPack(accentColor: AppAccentColor): AccentColorOption {
  return ACCENT_COLOR_MAP.get(accentColor) ?? ACCENT_COLOR_OPTIONS[0];
}

export function accentHexForMode(accentColor: AppAccentColor, light: boolean): string {
  const option = getAccentColorOptionFromPack(accentColor);
  return light ? option.lightHex : option.hex;
}
