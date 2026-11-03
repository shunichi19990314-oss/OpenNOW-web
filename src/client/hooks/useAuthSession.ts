import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type {
  AuthDeviceLoginChallenge,
  AuthSession,
  LoginProvider,
  SavedAccount,
  Settings,
} from "@shared/gfn";

import {
  canRenewDeviceCode,
  decideDevicePoll,
  nextPollIntervalSeconds,
  resolveInitialProviderId,
  shouldAutoStartDeviceLogin,
  type DevicePollStatus,
} from "../lib/deviceLoginFlow";
import { loadPreferredProviderIdpId, savePreferredProviderIdpId } from "../lib/loginPreferences";
import { getEnabledSessionProxyUrl } from "../lib/sessionProxy";
import type { RuntimeSnapshot } from "../lib/runtimeSnapshot";
import { loadRuntimeSnapshot } from "../lib/runtimeSnapshot";
import { VARIANT_SELECTION_LOCALSTORAGE_KEY } from "../lib/catalogPreferences";
import type { CatalogClearMode, ClearSessionCatalogOptions } from "./useCatalogData";

type TranslateFunction = typeof import("../i18n").t;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Poll interval that ends early when the tab becomes visible again.
 *
 * Browsers throttle timers in hidden tabs (roughly once a minute, and harder
 * after a few minutes). That is exactly the situation created by same-device
 * sign-in: the visitor taps the NVIDIA link, approves in the new tab, and our
 * tab sits backgrounded. Waking on visibility means the session appears the
 * moment they come back instead of up to a minute later.
 */
function sleepUntilNextPoll(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    if (typeof document === "undefined") {
      window.setTimeout(resolve, ms);
      return;
    }

    const timer = window.setTimeout(finish, ms);
    function finish(): void {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resolve();
    }
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") finish();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
  });
}

/**
 * Retry a bootstrap task with linear backoff. Only transport/server errors
 * reach here (a valid "not signed in" answer resolves normally), so retrying
 * cannot resurrect an intentionally logged-out state.
 */
async function withBootRetry<T>(task: () => Promise<T>, attempts = 4, baseDelayMs = 1500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(baseDelayMs * attempt);
      }
    }
  }
  throw lastError;
}

export interface UseAuthSessionInput {
  t: TranslateFunction;
  loadSessionRuntimeData: (
    session: AuthSession,
    options?: { background?: boolean; proxyUrl?: string },
  ) => Promise<void>;
  hydrateCatalogSnapshot: (session: AuthSession, proxyUrl?: string) => string | null;
  clearSessionCatalog: (mode: CatalogClearMode, options?: ClearSessionCatalogOptions) => void;
  resetLaunchRuntime: (options?: {
    keepLaunchError?: boolean;
    keepStreamingContext?: boolean;
  }) => void;
  refreshNavbarActiveSession: (sessionOverride?: AuthSession) => Promise<void>;
  onBootstrapSettings: (settings: Settings, sessionProxyUrl: string | undefined) => void;
  onBootstrapVariantSelections: (selections: Record<string, string>) => void;
  onBootstrapRuntimeSnapshot: (snapshot: RuntimeSnapshot | null) => void;
  setCurrentPage: Dispatch<SetStateAction<"home" | "library" | "settings">>;
  setNavbarActiveSession: Dispatch<SetStateAction<import("@shared/gfn").ActiveSessionInfo | null>>;
  setIsResumingNavbarSession: Dispatch<SetStateAction<boolean>>;
}

export interface AuthSessionApi {
  authSession: AuthSession | null;
  setAuthSession: Dispatch<SetStateAction<AuthSession | null>>;
  savedAccounts: SavedAccount[];
  setSavedAccounts: Dispatch<SetStateAction<SavedAccount[]>>;
  providers: LoginProvider[];
  providerIdpId: string;
  setProviderIdpId: Dispatch<SetStateAction<string>>;
  isLoggingIn: boolean;
  activeLoginMode: "oauth" | "qr" | null;
  loginError: string | null;
  setLoginError: Dispatch<SetStateAction<string | null>>;
  qrLoginChallenge: AuthDeviceLoginChallenge | null;
  /** How many times the code was replaced automatically after expiring. */
  qrRenewalsUsed: number;
  isInitializing: boolean;
  startupStatusMessage: string;
  startupRefreshNotice: { tone: "success" | "warn"; text: string } | null;
  setStartupRefreshNotice: Dispatch<SetStateAction<{ tone: "success" | "warn"; text: string } | null>>;
  accountToRemove: string | null;
  setAccountToRemove: Dispatch<SetStateAction<string | null>>;
  removeAccountConfirmOpen: boolean;
  setRemoveAccountConfirmOpen: Dispatch<SetStateAction<boolean>>;
  logoutConfirmOpen: boolean;
  setLogoutConfirmOpen: Dispatch<SetStateAction<boolean>>;
  selectedProvider: LoginProvider | null;
  refreshSavedAccounts: () => Promise<SavedAccount[]>;
  handleQrLogin: () => Promise<void>;
  handleCancelQrLogin: () => void;
  handleSwitchAccount: (userId: string) => Promise<void>;
  handleRemoveAccount: (userId: string) => void;
  confirmRemoveAccount: () => Promise<void>;
  handleAddAccount: () => void;
  confirmLogout: () => Promise<void>;
  handleLogout: () => void;
  accountToRemoveDisplayName: string;
}

export function useAuthSession({
  t,
  loadSessionRuntimeData,
  hydrateCatalogSnapshot,
  clearSessionCatalog,
  resetLaunchRuntime,
  refreshNavbarActiveSession,
  onBootstrapSettings,
  onBootstrapVariantSelections,
  onBootstrapRuntimeSnapshot,
  setCurrentPage,
  setNavbarActiveSession,
  setIsResumingNavbarSession,
}: UseAuthSessionInput): AuthSessionApi {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [providers, setProviders] = useState<LoginProvider[]>([]);
  const [providerIdpId, setProviderIdpId] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeLoginMode, setActiveLoginMode] = useState<"oauth" | "qr" | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [qrLoginChallenge, setQrLoginChallenge] = useState<AuthDeviceLoginChallenge | null>(null);
  const [qrRenewalsUsed, setQrRenewalsUsed] = useState(0);
  const [isInitializing, setIsInitializing] = useState(true);
  const [startupStatusMessage, setStartupStatusMessage] = useState(() => t("auth.status.restoringSavedSession"));
  const [startupRefreshNotice, setStartupRefreshNotice] = useState<{
    tone: "success" | "warn";
    text: string;
  } | null>(null);
  const [accountToRemove, setAccountToRemove] = useState<string | null>(null);
  const [removeAccountConfirmOpen, setRemoveAccountConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const hasInitializedRef = useRef(false);
  const qrLoginAttemptRef = useRef(0);
  const completingQrLoginRef = useRef(false);
  /** Set when the visitor cancels, so we never auto-start a code behind them. */
  const userDismissedQrRef = useRef(false);
  /** One-shot guard for the automatic first code (React StrictMode safe). */
  const autoStartAttemptedRef = useRef(false);

  const selectedProvider = useMemo(() => {
    return providers.find((p) => p.idpId === providerIdpId) ?? authSession?.provider ?? null;
  }, [providers, providerIdpId, authSession]);

  const refreshSavedAccounts = useCallback(async (): Promise<SavedAccount[]> => {
    const accounts = await window.openNow.getSavedAccounts();
    setSavedAccounts(accounts);
    return accounts;
  }, []);

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const initialize = async () => {
      try {
        const loadedSettings = await window.openNow.getSettings();
        const loadedSessionProxyUrl = getEnabledSessionProxyUrl(loadedSettings);
        onBootstrapSettings(loadedSettings, loadedSessionProxyUrl);

        setStartupStatusMessage(t("auth.status.restoringSavedSession"));
        // Retry the boot fetches before concluding there is no session: a
        // Railway redeploy, cold boot, or transient network error otherwise
        // drops visitors to the login screen even though their session cookie
        // is perfectly valid.
        const [providerList, sessionResult] = await withBootRetry(() =>
          Promise.all([
            window.openNow.getLoginProviders(),
            window.openNow.getAuthSession(),
          ]),
        );
        const accounts = await window.openNow.getSavedAccounts();
        const persistedSession = sessionResult.session;

        if (sessionResult.refresh.outcome === "refreshed") {
          setStartupRefreshNotice({
            tone: "success",
            text: t("auth.status.sessionRestoredTokenRefreshed"),
          });
          setStartupStatusMessage(t("auth.status.tokenRefreshedLoadingAccount"));
        } else if (sessionResult.refresh.outcome === "failed") {
          setStartupRefreshNotice({
            tone: "warn",
            text: t("auth.status.tokenRefreshFailedUsingSaved"),
          });
          setStartupStatusMessage(t("auth.status.tokenRefreshFailedContinuing"));
        } else if (sessionResult.refresh.outcome === "missing_refresh_token") {
          setStartupStatusMessage(t("auth.status.missingRefreshTokenContinuing"));
        } else if (persistedSession) {
          setStartupStatusMessage(t("auth.status.sessionRestored"));
        } else {
          setStartupStatusMessage(t("auth.status.noSavedSessionFound"));
        }

        try {
          const raw = localStorage.getItem(VARIANT_SELECTION_LOCALSTORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
              onBootstrapVariantSelections(parsed as Record<string, string>);
            }
          }
        } catch {
          // ignore parse/storage errors
        }

        const persistedRuntimeSnapshot = loadRuntimeSnapshot();
        onBootstrapRuntimeSnapshot(persistedRuntimeSnapshot);

        setProviders(providerList);
        setAuthSession(persistedSession);
        setSavedAccounts(accounts);

        // Preselect the provider of the restored session, else the one this
        // device used last, else NVIDIA's top-priority entry. Remembering the
        // choice removes a dropdown stop from every return visit.
        const activeProviderId = resolveInitialProviderId({
          providers: providerList,
          persistedProviderIdpId: persistedSession?.provider?.idpId ?? null,
          storedProviderIdpId: loadPreferredProviderIdpId(),
        });
        setProviderIdpId(activeProviderId);

        if (persistedSession) {
          const hydrated = hydrateCatalogSnapshot(persistedSession, loadedSessionProxyUrl);
          void loadSessionRuntimeData(persistedSession, { background: hydrated !== null, proxyUrl: loadedSessionProxyUrl });
        } else {
          clearSessionCatalog("no-session");
        }

        setIsInitializing(false);
      } catch (error) {
        console.error("Initialization failed:", error);
        setStartupStatusMessage(t("auth.status.sessionRestoreFailed"));
        setIsInitializing(false);
      }
    };

    void initialize();
  }, [
    clearSessionCatalog,
    hydrateCatalogSnapshot,
    loadSessionRuntimeData,
    onBootstrapRuntimeSnapshot,
    onBootstrapSettings,
    onBootstrapVariantSelections,
    t,
  ]);

  const handleCancelQrLogin = useCallback(() => {
    if (completingQrLoginRef.current) {
      return;
    }
    qrLoginAttemptRef.current += 1;
    // An explicit cancel must stick: without this the auto-start effect would
    // immediately request another code and the button would appear broken.
    userDismissedQrRef.current = true;
    if (qrLoginChallenge) {
      void window.openNow.cancelDeviceLogin({ attemptId: qrLoginChallenge.attemptId }).catch(() => {
        // Best effort: the server drops the attempt when it expires anyway.
      });
    }
    setQrLoginChallenge(null);
    setQrRenewalsUsed(0);
    setIsLoggingIn(false);
    setActiveLoginMode(null);
    setLoginError(null);
  }, [qrLoginChallenge]);

  const handleQrLogin = useCallback(async () => {
    const attemptId = qrLoginAttemptRef.current + 1;
    qrLoginAttemptRef.current = attemptId;
    completingQrLoginRef.current = false;
    userDismissedQrRef.current = false;
    setIsLoggingIn(true);
    setActiveLoginMode("qr");
    setLoginError(null);
    setQrRenewalsUsed(0);
    if (qrLoginChallenge) {
      void window.openNow.cancelDeviceLogin({ attemptId: qrLoginChallenge.attemptId }).catch(() => {
        // Best effort.
      });
    }
    setQrLoginChallenge(null);

    /** True once a newer login attempt (or a cancel) superseded this one. */
    const isStale = (): boolean => qrLoginAttemptRef.current !== attemptId;
    const cancelQuietly = (supersededAttemptId: string): void => {
      void window.openNow.cancelDeviceLogin({ attemptId: supersededAttemptId }).catch(() => {
        // Best effort.
      });
    };

    try {
      let challenge = await window.openNow.startDeviceLogin({ providerIdpId: providerIdpId || undefined });
      if (isStale()) {
        cancelQuietly(challenge.attemptId);
        return;
      }

      let renewalsUsed = 0;
      // Outer loop: one pass per issued code. An expired code is replaced
      // silently (up to MAX_QR_AUTO_RENEWALS) because device codes live only a
      // few minutes and the visitor is often still fetching their phone.
      for (;;) {
        setQrLoginChallenge(challenge);
        let intervalSeconds = Math.max(1, challenge.intervalSeconds);
        let outcome: "authorized" | "stale" | "renew" = "renew";

        while (Date.now() < challenge.expiresAt) {
          await sleepUntilNextPoll(intervalSeconds * 1000);
          if (isStale()) {
            outcome = "stale";
            break;
          }

          const result = await window.openNow.pollDeviceLogin({
            attemptId: challenge.attemptId,
            deviceCode: challenge.deviceCode,
          });
          if (isStale()) {
            outcome = "stale";
            break;
          }

          if (result.status === "authorized") {
            outcome = "authorized";
            break;
          }

          const decision = decideDevicePoll(result.status as DevicePollStatus);
          if (decision === "abort") {
            throw new Error(result.error ?? t("errors.loginFailed"));
          }
          intervalSeconds = nextPollIntervalSeconds(intervalSeconds, decision);
          if (decision === "renew-code") break;
        }

        if (outcome === "stale") return;

        if (outcome === "authorized") {
          completingQrLoginRef.current = true;
          setQrLoginChallenge(null);
          setActiveLoginMode(null);
          const session = await window.openNow.completeDeviceLogin({ attemptId: challenge.attemptId });
          if (isStale()) return;
          setAuthSession(session);
          setProviderIdpId(session.provider.idpId);
          savePreferredProviderIdpId(session.provider.idpId);
          await refreshSavedAccounts();
          await loadSessionRuntimeData(session);
          return;
        }

        if (!canRenewDeviceCode(renewalsUsed)) {
          throw new Error(t("auth.qr.expired"));
        }
        renewalsUsed += 1;
        setQrRenewalsUsed(renewalsUsed);
        cancelQuietly(challenge.attemptId);
        setQrLoginChallenge(null);
        challenge = await window.openNow.startDeviceLogin({ providerIdpId: providerIdpId || undefined });
        if (isStale()) {
          cancelQuietly(challenge.attemptId);
          return;
        }
      }
    } catch (error) {
      if (!isStale()) {
        setLoginError(error instanceof Error ? error.message : t("errors.loginFailed"));
      }
    } finally {
      if (!isStale()) {
        setQrLoginChallenge(null);
        setIsLoggingIn(false);
        setActiveLoginMode(null);
        completingQrLoginRef.current = false;
      }
    }
  }, [loadSessionRuntimeData, providerIdpId, qrLoginChallenge, refreshSavedAccounts, t]);

  // Remember the provider as soon as it is chosen so the next visit skips the
  // dropdown even if this attempt never completes.
  useEffect(() => {
    if (providerIdpId) savePreferredProviderIdpId(providerIdpId);
  }, [providerIdpId]);

  /**
   * Request the first sign-in code without waiting for a click.
   *
   * The login screen used to sit idle until "Sign in with QR code" was pressed,
   * which is a pointless tap: the code is free to request and expires on its
   * own. Guarded by resolveInitialProviderId (never fires before the provider
   * list arrives), by the restored-session check (never fires for someone
   * already signed in) and by a one-shot ref (React StrictMode runs effects
   * twice).
   */
  useEffect(() => {
    const shouldStart = shouldAutoStartDeviceLogin({
      isInitializing,
      hasSession: authSession !== null,
      providersReady: providers.length > 0,
      hasSelectedProvider: providerIdpId.length > 0,
      isLoginActive: isLoggingIn || activeLoginMode !== null || qrLoginChallenge !== null,
      userDismissed: userDismissedQrRef.current,
      alreadyAutoStarted: autoStartAttemptedRef.current,
    });
    if (!shouldStart) return;
    autoStartAttemptedRef.current = true;
    void handleQrLogin();
  }, [
    activeLoginMode,
    authSession,
    handleQrLogin,
    isInitializing,
    isLoggingIn,
    providerIdpId,
    providers.length,
    qrLoginChallenge,
  ]);

  const handleSwitchAccount = useCallback(async (userId: string) => {
    try {
      const session = await window.openNow.switchAccount(userId);
      setAuthSession(session);
      setProviderIdpId(session.provider.idpId);
      await refreshSavedAccounts();
      await loadSessionRuntimeData(session);
      await refreshNavbarActiveSession(session);
    } catch (error) {
      console.warn("Failed to switch account:", error);
      setLoginError(error instanceof Error ? error.message : t("errors.switchAccountFailed"));
      try {
        await refreshSavedAccounts();
        const sessionResult = await window.openNow.getAuthSession();
        setAuthSession(sessionResult.session);
        if (sessionResult.session) {
          setProviderIdpId(sessionResult.session.provider.idpId);
          await loadSessionRuntimeData(sessionResult.session);
          await refreshNavbarActiveSession(sessionResult.session);
        } else {
          clearSessionCatalog("no-session");
          setNavbarActiveSession(null);
        }
      } catch (recoveryError) {
        console.warn("Failed to recover account state after switch failure:", recoveryError);
      }
    }
  }, [
    clearSessionCatalog,
    loadSessionRuntimeData,
    refreshNavbarActiveSession,
    refreshSavedAccounts,
    setNavbarActiveSession,
    t,
  ]);

  const handleRemoveAccount = useCallback((userId: string) => {
    setAccountToRemove(userId);
    setRemoveAccountConfirmOpen(true);
  }, []);

  const confirmRemoveAccount = useCallback(async () => {
    if (!accountToRemove) return;
    const targetUserId = accountToRemove;
    setRemoveAccountConfirmOpen(false);
    setAccountToRemove(null);

    await window.openNow.removeAccount(targetUserId);
    const [accounts, sessionResult] = await Promise.all([
      window.openNow.getSavedAccounts(),
      window.openNow.getAuthSession(),
    ]);
    setSavedAccounts(accounts);
    setAuthSession(sessionResult.session);
    if (sessionResult.session) {
      setProviderIdpId(sessionResult.session.provider.idpId);
      await loadSessionRuntimeData(sessionResult.session);
      await refreshNavbarActiveSession(sessionResult.session);
      return;
    }
    clearSessionCatalog("no-session", { clearFeatured: true });
    setNavbarActiveSession(null);
  }, [
    accountToRemove,
    clearSessionCatalog,
    loadSessionRuntimeData,
    refreshNavbarActiveSession,
    setNavbarActiveSession,
  ]);

  const handleAddAccount = useCallback(() => {
    setAuthSession(null);
    setLoginError(null);
    // "Add account" is an explicit intent to sign in again, so re-arm the
    // auto-start and let the code appear immediately.
    userDismissedQrRef.current = false;
    autoStartAttemptedRef.current = false;
  }, []);

  const confirmLogout = useCallback(async () => {
    setLogoutConfirmOpen(false);
    clearSessionCatalog("logout");
    await window.openNow.logoutAll();
    setAuthSession(null);
    setSavedAccounts([]);
    resetLaunchRuntime();
    setNavbarActiveSession(null);
    setIsResumingNavbarSession(false);
    setCurrentPage("home");
  }, [
    clearSessionCatalog,
    resetLaunchRuntime,
    setCurrentPage,
    setIsResumingNavbarSession,
    setNavbarActiveSession,
  ]);

  const handleLogout = useCallback(() => {
    setLogoutConfirmOpen(true);
  }, []);

  const accountToRemoveDisplayName = useMemo(() => (
    savedAccounts.find((account) => account.userId === accountToRemove)?.displayName ?? t("auth.accounts.thisAccount")
  ), [accountToRemove, savedAccounts, t]);

  useEffect(() => {
    if (!startupRefreshNotice) return;
    const timer = window.setTimeout(() => setStartupRefreshNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [startupRefreshNotice]);

  return {
    authSession,
    setAuthSession,
    savedAccounts,
    setSavedAccounts,
    providers,
    providerIdpId,
    setProviderIdpId,
    isLoggingIn,
    activeLoginMode,
    loginError,
    setLoginError,
    qrLoginChallenge,
    qrRenewalsUsed,
    isInitializing,
    startupStatusMessage,
    startupRefreshNotice,
    setStartupRefreshNotice,
    accountToRemove,
    setAccountToRemove,
    removeAccountConfirmOpen,
    setRemoveAccountConfirmOpen,
    logoutConfirmOpen,
    setLogoutConfirmOpen,
    selectedProvider,
    refreshSavedAccounts,
    handleQrLogin,
    handleCancelQrLogin,
    handleSwitchAccount,
    handleRemoveAccount,
    confirmRemoveAccount,
    handleAddAccount,
    confirmLogout,
    handleLogout,
    accountToRemoveDisplayName,
  };
}
