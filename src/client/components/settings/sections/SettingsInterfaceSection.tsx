import { Check, Monitor } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { Settings } from "@shared/gfn";
import { getAccentColorSwatch } from "../../../lib/uiCustomization";
import { useTranslation } from "../../../i18n";
import { SelectDropdown } from "../../ui/SelectDropdown";
import {
  accentColorOptions,
  getAppLanguageLabel,
  POSTER_SIZE_MAX,
  POSTER_SIZE_MIN,
  POSTER_SIZE_STEP,
} from "../settingsFormatters";
import {
  getThemePack,
  resolveThemePackPalette,
  THEME_PACKS,
} from "../../../lib/themePacks";

export interface SettingsInterfaceSectionProps {
  settings: Settings;
  showAll: boolean;
  handleChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onSaved: () => void;
}

export function SettingsInterfaceSection({ settings, showAll, handleChange, onSaved }: SettingsInterfaceSectionProps): JSX.Element {
  const { locale, availableLocales, setLocale, t } = useTranslation();
  const [appLanguageDropdownOpen, setAppLanguageDropdownOpen] = useState(false);
  const appLanguageDropdownRef = useRef<HTMLDivElement | null>(null);
  const [accentColorDropdownOpen, setAccentColorDropdownOpen] = useState(false);
  const accentColorDropdownRef = useRef<HTMLDivElement | null>(null);
  const posterSizePercent = Math.round(settings.posterSizeScale * 100);

  // Sort by the endonym the visitor actually reads, not by locale code: the
  // previous order interleaved scripts (日本語, 한국어 before Nederlands).
  const appLanguageOptions = useMemo(
    () => availableLocales
      .map((value) => ({ value, label: getAppLanguageLabel(value) }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    [availableLocales],
  );

  const selectedAppLanguageName = useMemo(() => {
    return appLanguageOptions.find((option) => option.value === locale)?.label ?? getAppLanguageLabel(locale);
  }, [appLanguageOptions, locale]);

  const selectedThemePack = useMemo(() => getThemePack(settings.themePack), [settings.themePack]);
  const selectedAccentColor = useMemo(
    () => getAccentColorSwatch(settings.appAccentColor, settings.appTheme === "light"),
    [settings.appAccentColor, settings.appTheme],
  );
  // Swatches are painted against the appearance the visitor is looking at, so a
  // light-mode picker does not advertise the neon dark-mode accents.
  const appearanceIsLight = typeof document !== "undefined" && document.documentElement.dataset.theme === "light";

  const handleAppLanguageChange = useCallback((nextLocale: string): void => {
    setAppLanguageDropdownOpen(false);
    void setLocale(nextLocale).catch((error) => {
      console.warn("[Settings] Failed to change app language:", error);
    });
    onSaved();
  }, [onSaved, setLocale]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (appLanguageDropdownRef.current && !appLanguageDropdownRef.current.contains(target)) {
        setAppLanguageDropdownOpen(false);
      }
      if (accentColorDropdownRef.current && !accentColorDropdownRef.current.contains(target)) {
        setAccentColorDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <>
      {/* ── Appearance ── */}
      <section className="settings-section">
        {showAll && <div className="settings-section-context">{t("settings.sections.interface")}</div>}
        <div className="settings-section-header">
          <Monitor size={18} />
          <h2>{t("settings.interface.appearance")}</h2>
        </div>
        <div className="settings-rows">
          <div className="settings-row">
            <label className="settings-label">
              {t("settings.interface.appLanguage")}
              <span className="settings-hint">{t("settings.interface.appLanguageHint")}</span>
            </label>
            <div className="settings-dropdown" ref={appLanguageDropdownRef}>
              <button
                type="button"
                className={`settings-dropdown-selected ${appLanguageDropdownOpen ? "open" : ""}`}
                onClick={() => setAppLanguageDropdownOpen((open) => !open)}
              >
                <span className="settings-dropdown-selected-name">{selectedAppLanguageName}</span>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" className={`settings-dropdown-chevron ${appLanguageDropdownOpen ? "flipped" : ""}`}>
                  <path d="M4.47 5.97a.75.75 0 0 1 1.06 0L8 8.44l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </button>
              {appLanguageDropdownOpen && (
                <div className="settings-dropdown-menu">
                  {appLanguageOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`settings-dropdown-item ${locale === option.value ? "active" : ""}`}
                      onClick={() => handleAppLanguageChange(option.value)}
                    >
                      <span>{option.label}</span>
                      {locale === option.value && <Check size={14} className="settings-dropdown-check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="settings-row">
            <label className="settings-label" htmlFor="appTheme">
              {t("settings.interface.theme")}
              <span className="settings-hint">{t("settings.interface.themeHint")}</span>
            </label>
            <SelectDropdown
              id="appTheme"
              value={settings.appTheme}
              options={[
                { value: "auto", label: t("settings.interface.themeAuto") },
                { value: "light", label: t("settings.interface.themeLight") },
                { value: "dark", label: t("settings.interface.themeDark") },
              ]}
              onChange={(value) => handleChange("appTheme", value as any)}
              ariaLabel={t("settings.interface.theme")}
            />
          </div>

          <div className="settings-row">
            <label className="settings-label">
              {t("settings.interface.translucentUI")}
              <span className="settings-hint">{t("settings.interface.translucentUIHint")}</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.translucentUI}
                onChange={(e) => handleChange("translucentUI", e.target.checked)}
              />
              <span className="settings-toggle-track" />
            </label>
          </div>

          <div className="settings-row settings-row--stacked">
            <label className="settings-label">
              {t("settings.interface.themePack")}
              <span className="settings-hint">{t("settings.interface.themePackHint")}</span>
            </label>
            <div className="theme-pack-grid" role="radiogroup" aria-label={t("settings.interface.themePack")}>
              {THEME_PACKS.map((pack) => {
                const palette = resolveThemePackPalette(pack, appearanceIsLight);
                const active = selectedThemePack.id === pack.id;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`theme-pack-card${active ? " theme-pack-card--active" : ""}`}
                    onClick={() => handleChange("themePack", pack.id)}
                    title={pack.name}
                  >
                    <span
                      className="theme-pack-swatch"
                      aria-hidden="true"
                      style={{
                        background: `linear-gradient(135deg, ${palette.shell} 0%, ${pack.mid} 62%, ${palette.accent} 100%)`,
                      }}
                    >
                      <span className="theme-pack-swatch-dot" style={{ background: palette.accent }} />
                    </span>
                    <span className="theme-pack-meta">
                      <span className="theme-pack-name">{pack.name}</span>
                      <span className="theme-pack-detail">{t(pack.detailKey)}</span>
                    </span>
                    {active && <Check size={14} className="theme-pack-check" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="settings-row">
            <label className="settings-label">
              {t("settings.interface.accentOverride")}
              <span className="settings-hint">{t("settings.interface.accentOverrideHint")}</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.themeAccentOverride}
                onChange={(e) => handleChange("themeAccentOverride", e.target.checked)}
              />
              <span className="settings-toggle-track" />
            </label>
          </div>

          <div className="settings-row">
            <label className="settings-label">
              {t("settings.interface.accentColor")}
              <span className="settings-hint">{t("settings.interface.accentColorHint")}</span>
            </label>
            <div className="settings-dropdown" ref={accentColorDropdownRef}>
              <button
                type="button"
                className={`settings-dropdown-selected ${accentColorDropdownOpen ? "open" : ""}`}
                onClick={() => setAccentColorDropdownOpen((open) => !open)}
              >
                <span className="settings-dropdown-selected-name" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 9999,
                      background: selectedAccentColor.hex,
                      boxShadow: `0 0 0 1px color-mix(in srgb, ${selectedAccentColor.hex} 48%, rgba(255, 255, 255, 0.22))`,
                    }}
                  />
                  {t(selectedAccentColor.labelKey)}
                </span>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" className={`settings-dropdown-chevron ${accentColorDropdownOpen ? "flipped" : ""}`}>
                  <path d="M4.47 5.97a.75.75 0 0 1 1.06 0L8 8.44l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </button>
              {accentColorDropdownOpen && (
                <div className="settings-dropdown-menu">
                  {accentColorOptions.map((packOption) => {
                    const option = getAccentColorSwatch(packOption.value, appearanceIsLight);
                    return (
                    <button
                      key={option.value}
                      type="button"
                      className={`settings-dropdown-item ${settings.appAccentColor === option.value ? "active" : ""}`}
                      onClick={() => {
                        handleChange("appAccentColor", option.value);
                        setAccentColorDropdownOpen(false);
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flex: 1 }}>
                        <span
                          aria-hidden="true"
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 9999,
                            flexShrink: 0,
                            flex: "0 0 20px",
                            background: option.hex,
                            boxShadow: `0 0 0 1px color-mix(in srgb, ${option.hex} 48%, rgba(255, 255, 255, 0.22))`,
                          }}
                        />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t(option.labelKey)}
                        </span>
                      </span>
                      {settings.appAccentColor === option.value && <Check size={14} className="settings-dropdown-check" />}
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Appearance toggles */}
          <div className="settings-toggle-grid">
            <div className="settings-row">
              <label className="settings-label">
                {t("settings.interface.hideStreamOverlayButtons")}
                <span className="settings-hint">{t("settings.interface.hideStreamOverlayButtonsHint")}</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.hideStreamButtons}
                  onChange={(e) => handleChange("hideStreamButtons", e.target.checked)}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>

            <div className="settings-row">
              <label className="settings-label">
                {t("settings.interface.showStatsOnStreamLaunch")}
                <span className="settings-hint">{t("settings.interface.showStatsOnStreamLaunchHint")}</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.showStatsOnLaunch}
                  onChange={(e) => handleChange("showStatsOnLaunch", e.target.checked)}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>

            <div className="settings-row">
              <label className="settings-label">
                {t("settings.interface.hideServerSelector")}
                <span className="settings-hint">{t("settings.interface.hideServerSelectorHint")}</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.hideServerSelector}
                  onChange={(e) => handleChange("hideServerSelector", e.target.checked)}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>

            <div className="settings-row">
              <label className="settings-label">
                {t("settings.interface.showAntiAfkIndicator")}
                <span className="settings-hint">{t("settings.interface.showAntiAfkIndicatorHint")}</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.showAntiAfkIndicator}
                  onChange={(e) => handleChange("showAntiAfkIndicator", e.target.checked)}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>

            <div className="settings-row">
              <label className="settings-label">
                {t("settings.interface.autoFullScreen")}
                <span className="settings-hint">{t("settings.interface.autoFullScreenHint")}</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.autoFullScreen}
                  onChange={(e) => handleChange("autoFullScreen", e.target.checked)}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>

            <div className="settings-row">
              <label className="settings-label">
                {t("settings.interface.escapeExitsFullscreen")}
                <span className="settings-hint">{t("settings.interface.escapeExitsFullscreenHint")}</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(settings.allowEscapeToExitFullscreen)}
                  onChange={(e) => handleChange("allowEscapeToExitFullscreen", e.target.checked)}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>

            <div className="settings-row">
              <label className="settings-label">
                {t("settings.interface.discordRichPresence")}
                <span className="settings-hint">{t("settings.interface.discordRichPresenceHint")}</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.discordRichPresence}
                  onChange={(e) => handleChange("discordRichPresence", e.target.checked)}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>
          </div>

          <div className="settings-row settings-row--column">
            <div className="settings-row-top">
              <label className="settings-label">{t("settings.interface.posterSize")}</label>
              <span className="settings-value-badge">{posterSizePercent}%</span>
            </div>
            <input
              type="range"
              className="settings-slider"
              min={POSTER_SIZE_MIN}
              max={POSTER_SIZE_MAX}
              step={POSTER_SIZE_STEP}
              value={posterSizePercent}
              onChange={(e) => handleChange("posterSizeScale", Number(e.target.value) / 100)}
            />
            <span className="settings-subtle-hint">{t("settings.interface.posterSizeHint")}</span>
          </div>

          <div className="settings-row">
            <label className="settings-label">
              {t("settings.interface.showSessionTimeRemainingInStatsOverlay")}
              <span className="settings-hint">{t("settings.interface.showSessionTimeRemainingInStatsOverlayHint")}</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.showSessionTimeRemainingInStatsOverlay}
                onChange={(e) => handleChange("showSessionTimeRemainingInStatsOverlay", e.target.checked)}
              />
              <span className="settings-toggle-track" />
            </label>
          </div>

          {/* Session Counter */}
          <div className="settings-row">
            <label className="settings-label">
              {t("settings.interface.sessionElapsedCounter")}
              <span className="settings-hint">{t("settings.interface.sessionElapsedCounterHint")}</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.sessionCounterEnabled}
                onChange={(e) => handleChange("sessionCounterEnabled", e.target.checked)}
              />
              <span className="settings-toggle-track" />
            </label>
          </div>

          {settings.sessionCounterEnabled && (
            <>
              <div className="settings-row settings-row--column">
                <div className="settings-row-top">
                  <label className="settings-label">{t("settings.interface.sessionTimerReappear")}</label>
                  <span className="settings-value-badge">
                    {settings.sessionClockShowEveryMinutes === 0
                      ? t("settings.interface.off")
                      : t("settings.interface.everyMinutes", { count: settings.sessionClockShowEveryMinutes })}
                  </span>
                </div>
                <input
                  type="range"
                  className="settings-slider"
                  min={0}
                  max={120}
                  step={5}
                  value={settings.sessionClockShowEveryMinutes}
                  onChange={(e) => handleChange("sessionClockShowEveryMinutes", parseInt(e.target.value, 10))}
                />
                <span className="settings-subtle-hint">{t("settings.interface.sessionTimerReappearHint")}</span>
              </div>

              <div className="settings-row settings-row--column">
                <div className="settings-row-top">
                  <label className="settings-label">{t("settings.interface.sessionTimerVisibleTime")}</label>
                  <span className="settings-value-badge">
                    {t("app.units.seconds", { value: settings.sessionClockShowDurationSeconds })}
                  </span>
                </div>
                <input
                  type="range"
                  className="settings-slider"
                  min={5}
                  max={120}
                  step={5}
                  value={settings.sessionClockShowDurationSeconds}
                  onChange={(e) => handleChange("sessionClockShowDurationSeconds", parseInt(e.target.value, 10))}
                />
                <span className="settings-subtle-hint">{t("settings.interface.sessionTimerVisibleTimeHint")}</span>
              </div>
            </>
          )}
        </div>
      </section>

    </>
  );
}
