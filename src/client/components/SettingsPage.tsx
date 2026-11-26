import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import type {
  EntitledResolution,
  Settings,
  StreamRegion,
  SubscriptionInfo,
} from "@shared/gfn";
import { useTranslation } from "../i18n";
import type { CodecTestResult } from "../lib/codecDiagnostics";
import {
  loadCachedEntitledResolutions,
  saveCachedEntitledResolutions,
} from "./settings/settingsFormatters";
import type { SettingsSectionId, SettingsSearchScopeId } from "./settings/settingsTypes";
import { SETTINGS_SCOPE_LABEL_KEYS, SETTINGS_SCOPE_SEARCH_TERMS } from "./settings/settingsTypes";
import { matchesSettingsQuery, tokenizeSettingsQuery } from "../lib/settingsSearch";
import type { StreamDiagnosticsStore } from "../utils/streamDiagnosticsStore";
import { SettingsNav } from "./settings/SettingsNav";
import { SettingsAccountSection } from "./settings/sections/SettingsAccountSection";
import { SettingsAboutSection } from "./settings/sections/SettingsAboutSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { SettingsUpdatesSection } from "./settings/sections/SettingsUpdatesSection";
import { SettingsAudioSection } from "./settings/sections/SettingsAudioSection";
import { SettingsGameSection } from "./settings/sections/SettingsGameSection";
import { SettingsInputSection } from "./settings/sections/SettingsInputSection";
import { SettingsAiSection } from "./settings/sections/SettingsAiSection";
import { SettingsInterfaceSection } from "./settings/sections/SettingsInterfaceSection";
import { SettingsStreamSection } from "./settings/sections/SettingsStreamSection";
import { SettingsStoresSection } from "./settings/sections/SettingsStoresSection";
import { SettingsSubscriptionSection } from "./settings/sections/SettingsSubscriptionSection";
import { SettingsRecordingSection } from "./settings/sections/SettingsRecordingSection";
import { SettingsConsoleSection } from "./settings/sections/SettingsConsoleSection";
import { SettingsThanksSection } from "./settings/sections/SettingsThanksSection";

export type { SettingsSectionId } from "./settings/settingsTypes";

interface SettingsPageProps {
  settings: Settings;
  regions: StreamRegion[];
  codecResults: CodecTestResult[] | null;
  codecTesting: boolean;
  onRunCodecTest: () => Promise<void>;
  onSettingChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onClose: () => void;
  focusSection?: SettingsSectionId;
  /** Called when the user clicks "What's new" in the About section */
  onOpenWhatsNew?: () => void;
  /** Live/last stream stats store, used by the diagnostics report */
  streamDiagnostics?: StreamDiagnosticsStore | null;
  /** Restores default settings; returns false when the reset failed. */
  onResetSettings?: () => Promise<boolean>;
  /** Opens the Captures page from the Recording section. */
  onOpenCaptures?: () => void;
}

export function SettingsPage({
  settings,
  regions,
  onSettingChange,
  codecResults,
  codecTesting,
  onRunCodecTest,
  onClose,
  focusSection,
  onOpenWhatsNew,
  streamDiagnostics,
  onResetSettings,
  onOpenCaptures,
}: SettingsPageProps): JSX.Element {
  const { t } = useTranslation();
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("stream");
  const [settingsSearch, setSettingsSearch] = useState("");
  const settingsSearchShowsAll = settingsSearch.trim().length > 0;
  const settingsContentRef = useRef<HTMLDivElement | null>(null);
  const [streamOverlayBlocking, setStreamOverlayBlocking] = useState(false);

  const [entitledResolutions, setEntitledResolutions] = useState<EntitledResolution[]>([]);
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);

  useEffect(() => {
    settingsContentRef.current?.scrollTo({ top: 0 });
  }, [activeSection, settingsSearchShowsAll]);

  useEffect(() => {
    if (!focusSection) return;
    setActiveSection(focusSection);
    setSettingsSearch("");
  }, [focusSection]);

  const handleChange = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      onSettingChange(key, value);
      setSavedIndicator(true);
      setTimeout(() => setSavedIndicator(false), 1500);
    },
    [onSettingChange],
  );

  const markSaved = useCallback(() => {
    setSavedIndicator(true);
    setTimeout(() => setSavedIndicator(false), 1500);
  }, []);

  const escapeBlocked = streamOverlayBlocking;

  const loadSubscriptionData = useCallback(async (isCancelled: () => boolean = () => false): Promise<void> => {
    setSubscriptionLoading(true);

    try {
      const sessionResult = await window.openNow.getAuthSession();
      const session = sessionResult.session;
      if (!session || isCancelled()) {
        setEntitledResolutions([]);
        setSubscriptionInfo(null);
        return;
      }

      const userId = session.user.userId;
      const cached = loadCachedEntitledResolutions();
      if (
        cached &&
        cached.userId === userId &&
        cached.membershipTier === session.user.membershipTier &&
        !isCancelled()
      ) {
        setEntitledResolutions(cached.entitledResolutions);
      }

      const sub = await window.openNow.fetchSubscription({
        userId,
      });

      if (!isCancelled()) {
        setSubscriptionInfo(sub);
        setEntitledResolutions(sub.entitledResolutions);
        saveCachedEntitledResolutions({
          userId,
          membershipTier: sub.membershipTier,
          entitledResolutions: sub.entitledResolutions,
        });
      }
    } catch (err) {
      console.warn("Failed to fetch subscription for settings:", err);
      if (!isCancelled()) {
        setSubscriptionInfo(null);
      }
    } finally {
      if (!isCancelled()) setSubscriptionLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSubscriptionData(() => cancelled);
    return () => { cancelled = true; };
  }, [loadSubscriptionData]);

  const showAll = settingsSearchShowsAll;
  const searchNeedles = tokenizeSettingsQuery(settingsSearch);
  const scopeMatchesSearch = (scopeId: SettingsSearchScopeId): boolean => {
    if (!showAll) {
      return true;
    }
    // The English term list alone never matched a Japanese query; the
    // translated section heading and its label key are searched too, so
    // 「マイク」「地域」「テーマ」 find the right sections.
    const haystack = [
      ...SETTINGS_SCOPE_SEARCH_TERMS[scopeId],
      scopeId,
      ...(SETTINGS_SCOPE_LABEL_KEYS[scopeId] ?? []).map((key) => t(key)),
    ];
    return matchesSettingsQuery(searchNeedles, haystack);
  };

  const showAccountStorage = showAll ? scopeMatchesSearch("account-storage") : activeSection === "account";
  const showAccount = showAccountStorage;
  const showStores = showAll ? scopeMatchesSearch("stores") : activeSection === "stores";
  const showSubscription = showAll ? scopeMatchesSearch("subscription") : activeSection === "subscription";
  const showConsole = showAll ? scopeMatchesSearch("console") : activeSection === "console";
  const showRecording = showAll ? scopeMatchesSearch("recording") : activeSection === "recording";
  const showStreamRegion = showAll ? scopeMatchesSearch("stream-region") : activeSection === "stream";
  const showStreamVideo = showAll ? scopeMatchesSearch("stream-video") : activeSection === "stream";
  const showStreamCodecDiagnostics = showAll ? scopeMatchesSearch("stream-codec-diagnostics") : activeSection === "stream";
  const showStream = showStreamRegion || showStreamVideo || showStreamCodecDiagnostics;
  const showGame = showAll ? scopeMatchesSearch("game") : activeSection === "game";
  const showAudio = showAll ? scopeMatchesSearch("audio") : activeSection === "audio";
  const showInput = showAll ? scopeMatchesSearch("input") : activeSection === "input";
  const showInterface = showAll ? scopeMatchesSearch("interface") : activeSection === "interface";
  const showUpdates = showAll ? scopeMatchesSearch("updates") : activeSection === "updates";
  const showAi = showAll ? scopeMatchesSearch("ai") : activeSection === "ai";
  const showAbout = showAll ? scopeMatchesSearch("about") : activeSection === "about";
  const showThanks = showAll ? scopeMatchesSearch("thanks") : activeSection === "thanks";
  const hasAnySearchMatches = showAccount || showStores || showSubscription || showRecording || showConsole || showStream || showGame || showAudio || showInput || showInterface || showUpdates || showAi || showAbout || showThanks;
  const shouldRenderSettingsSections = showAll || activeSection !== "thanks";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !escapeBlocked) {
        event.preventDefault();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [escapeBlocked, onClose]);

  return (
    <>
      <header className="settings-modal-header">
        <h1>{t("settings.title")}</h1>
        <div className="settings-modal-header-actions">
          <div className={`settings-saved ${savedIndicator ? "visible" : ""}`}>
            <Check size={14} />
            {t("settings.saved")}
          </div>
          <button
            type="button"
            className="settings-modal-close"
            onClick={onClose}
            title={t("app.actions.close")}
            aria-label={t("app.actions.close")}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="settings-layout">
        <SettingsNav
          activeSection={activeSection}
          settingsSearch={settingsSearch}
          showAll={showAll}
          onSearchChange={setSettingsSearch}
          onSectionChange={setActiveSection}
        />

        <div ref={settingsContentRef} className="settings-content">
          {showAll && !hasAnySearchMatches ? (
            <section className="settings-section">
              <div className="settings-thanks-state settings-thanks-state--muted">
                <span>{t("settings.noMatches", { query: settingsSearch.trim() })}</span>
              </div>
            </section>
          ) : (
            <>
              {showThanks && <SettingsThanksSection />}
              {shouldRenderSettingsSections && (
                <>
                  {showAccount && (
                    <SettingsAccountSection
                      settings={settings}
                      showAll={showAll}
                      subscriptionInfo={subscriptionInfo}
                      subscriptionLoading={subscriptionLoading}
                    />
                  )}
                  {showStores && (
                    <SettingsStoresSection settings={settings} showAll={showAll} />
                  )}
                  {showSubscription && (
                    <SettingsSubscriptionSection
                      showAll={showAll}
                      subscriptionInfo={subscriptionInfo}
                      subscriptionLoading={subscriptionLoading}
                      onRefresh={() => void loadSubscriptionData()}
                    />
                  )}
                  {(showStream || streamOverlayBlocking) && (
                    <SettingsStreamSection
                      settings={settings}
                      regions={regions}
                      showAll={showAll}
                      showStreamRegion={showStream && showStreamRegion}
                      showStreamVideo={showStream && showStreamVideo}
                      showStreamCodecDiagnostics={showStream && showStreamCodecDiagnostics}
                      handleChange={handleChange}
                      codecResults={codecResults}
                      codecTesting={codecTesting}
                      onRunCodecTest={onRunCodecTest}
                      entitledResolutions={entitledResolutions}
                      subscriptionInfoLoaded={subscriptionInfo !== null}
                      subscriptionLoading={subscriptionLoading}
                      onBlockingOverlayChange={setStreamOverlayBlocking}
                    />
                  )}
                  {showGame && (
                    <SettingsGameSection
                      settings={settings}
                      showAll={showAll}
                      handleChange={handleChange}
                    />
                  )}
                  {showConsole && (
                    <SettingsConsoleSection
                      settings={settings}
                      showAll={showAll}
                      handleChange={handleChange}
                      consoleModeActive={settings.controllerMode}
                    />
                  )}
                  {showRecording && (
                    <SettingsRecordingSection
                      settings={settings}
                      showAll={showAll}
                      handleChange={handleChange}
                      onOpenCaptures={onOpenCaptures}
                    />
                  )}
                  {showAudio && (
                    <SettingsAudioSection
                      settings={settings}
                      showAll={showAll}
                      handleChange={handleChange}
                    />
                  )}
                  {showInput && (
                    <SettingsInputSection
                      settings={settings}
                      showAll={showAll}
                      handleChange={handleChange}
                    />
                  )}
                  {showInterface && (
                    <SettingsInterfaceSection
                      settings={settings}
                      showAll={showAll}
                      handleChange={handleChange}
                      onSaved={markSaved}
                    />
                  )}
                  {showUpdates && (
                    <SettingsUpdatesSection showAll={showAll} onOpenWhatsNew={onOpenWhatsNew} />
                  )}
                  {showAi && <SettingsAiSection showAll={showAll} />}
                  {showAbout && (
                    <>
                      <SettingsAboutSection
                        showAll={showAll}
                        onOpenWhatsNew={onOpenWhatsNew}
                        onResetSettings={onResetSettings}
                        resetDisabled={streamOverlayBlocking}
                        onOpenUpdates={() => setActiveSection("updates")}
                      />
                      <DiagnosticsSection
                        showAll={showAll}
                        settings={settings}
                        streamDiagnostics={streamDiagnostics}
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
