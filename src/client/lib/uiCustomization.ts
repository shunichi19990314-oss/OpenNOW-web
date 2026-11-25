import type { AppAccentColor, AppTheme, ThemePackId } from "@shared/gfn";

import {
  ACCENT_COLOR_OPTIONS,
  accentHexForMode,
  getThemePack,
  resolveThemePackPalette,
  type AccentColorOption,
  type ThemePackDefinition,
} from "./themePacks";

export type { AccentColorOption, ThemePackCategory, ThemePackDefinition } from "./themePacks";
export {
  ACCENT_COLOR_OPTIONS,
  DEFAULT_THEME_PACK,
  THEME_PACKS,
  getThemePack,
  isKnownThemePackId,
  resolveThemePackPalette,
} from "./themePacks";

export interface AccentColorSwatch {
  value: AppAccentColor;
  labelKey: string;
  hex: `#${string}`;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex: string): RgbColor {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RgbColor): `#${string}` {
  const hex = [r, g, b]
    .map((channel) => clampByte(channel).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

function mixColors(base: RgbColor, target: RgbColor, amount: number): RgbColor {
  const mix = Math.max(0, Math.min(1, amount));
  return {
    r: clampByte(base.r + (target.r - base.r) * mix),
    g: clampByte(base.g + (target.g - base.g) * mix),
    b: clampByte(base.b + (target.b - base.b) * mix),
  };
}

function withAlpha({ r, g, b }: RgbColor, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getContrastRatio(fg: RgbColor, bg: RgbColor): number {
  const relativeLuminance = (rgb: RgbColor): number => {
    const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getContrastColor({ r, g, b }: RgbColor): string {
  const lightFg = { r: 248, g: 250, b: 252 };
  const darkFg = { r: 17, g: 19, b: 24 };
  const lightContrast = getContrastRatio(lightFg, { r, g, b });
  const darkContrast = getContrastRatio(darkFg, { r, g, b });
  return lightContrast > darkContrast ? "#f8fafc" : "#111318";
}

export function getAccentColorOptions(): readonly AccentColorOption[] {
  return ACCENT_COLOR_OPTIONS;
}

export function getAccentColorOption(accentColor: AppAccentColor): AccentColorOption {
  return ACCENT_COLOR_OPTIONS.find((option) => option.value === accentColor) ?? ACCENT_COLOR_OPTIONS[0];
}

/** Swatch shown in the settings picker, using the current appearance. */
export function getAccentColorSwatch(accentColor: AppAccentColor, light: boolean): AccentColorSwatch {
  const option = getAccentColorOption(accentColor);
  return { value: option.value, labelKey: option.labelKey, hex: light ? option.lightHex : option.hex };
}

function applyAccent(accentHex: string, target: HTMLElement): void {
  const baseRgb = hexToRgb(accentHex);
  const hoverRgb = mixColors(baseRgb, { r: 255, g: 255, b: 255 }, 0.12);
  const pressRgb = mixColors(baseRgb, { r: 0, g: 0, b: 0 }, 0.12);

  target.style.setProperty("--accent", accentHex);
  target.style.setProperty("--accent-hover", rgbToHex(hoverRgb));
  target.style.setProperty("--accent-press", rgbToHex(pressRgb));
  target.style.setProperty("--accent-rgb", `${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}`);
  target.style.setProperty("--accent-glow", withAlpha(baseRgb, 0.25));
  target.style.setProperty("--accent-surface", withAlpha(baseRgb, 0.08));
  target.style.setProperty("--accent-surface-strong", withAlpha(baseRgb, 0.14));
  target.style.setProperty("--accent-on", getContrastColor(baseRgb));
}

export function applyAccentColor(accentColor: AppAccentColor, root: HTMLElement | null = null): void {
  const target = root ?? document.documentElement;
  const light = target.dataset.theme === "light";
  applyAccent(accentHexForMode(accentColor, light), target);
}

/**
 * Paint the shell, panels and ink derived from a colour pack.
 *
 * The pack owns the palette (the desktop build does the same in
 * `Theme.qml`): the shell colour is the backdrop, `mid` lifts panels/cards off
 * it, and the accent either comes from the pack or from the accent preset when
 * the user overrides it. Writing the tokens here keeps `styles.css` free of a
 * per-pack rule set.
 */
export function applyThemePack(
  themePack: ThemePackId | undefined,
  options: {
    theme?: AppTheme;
    accentColor?: AppAccentColor;
    accentOverride?: boolean;
  } = {},
  root: HTMLElement | null = null,
): void {
  const target = root ?? document.documentElement;
  const pack: ThemePackDefinition = getThemePack(themePack);
  const light = target.dataset.theme === "light";
  const palette = resolveThemePackPalette(pack, light);
  const shell = hexToRgb(palette.shell);
  const mid = hexToRgb(palette.mid);

  target.style.setProperty("--bg-a", palette.shell);
  target.style.setProperty("--bg-b", rgbToHex(mixColors(shell, mid, 0.32)));
  target.style.setProperty("--bg-c", rgbToHex(mixColors(shell, mid, 0.58)));
  target.style.setProperty("--panel", rgbToHex(mixColors(shell, mid, 0.26)));
  target.style.setProperty("--card", rgbToHex(mixColors(shell, mid, 0.2)));
  target.style.setProperty("--card-hover", rgbToHex(mixColors(shell, mid, 0.34)));
  target.style.setProperty("--chip", rgbToHex(mixColors(shell, mid, 0.42)));
  target.style.setProperty("--panel-border-solid", rgbToHex(mixColors(shell, mid, 0.7)));

  const ink = light ? { r: 17, g: 24, b: 39 } : { r: 255, g: 255, b: 255 };
  target.style.setProperty("--ink", rgbToHex(ink));
  target.style.setProperty("--ink-soft", withAlpha(ink, light ? 0.72 : 0.68));
  target.style.setProperty("--ink-muted", withAlpha(ink, light ? 0.55 : 0.5));
  target.style.setProperty("--panel-border", withAlpha(ink, 0.1));

  const accentHex = options.accentOverride && options.accentColor
    ? accentHexForMode(options.accentColor, light)
    : palette.accent;
  applyAccent(accentHex, target);
}

export function applyTheme(theme: AppTheme, root: HTMLElement | null = null): void {
  const target = root ?? document.documentElement;
  if (theme === "auto") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    target.dataset.theme = isDark ? "dark" : "light";
  } else {
    target.dataset.theme = theme;
  }
}

export function applyTranslucentUI(enabled: boolean, root: HTMLElement | null = null): void {
  const target = root ?? document.documentElement;
  target.dataset.translucent = enabled ? "true" : "false";
}
