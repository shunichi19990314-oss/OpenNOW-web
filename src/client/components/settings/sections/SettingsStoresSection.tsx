import { Users, ExternalLink, RefreshCcw, Trash2, AlertTriangle, Check } from "lucide-react";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { GameAccountConnection, Settings } from "@shared/gfn";
import { useTranslation } from "../../../i18n";
import { formatGameAccountSyncDate } from "../settingsFormatters";
import type { GameAccountBusyAction } from "../settingsTypes";
import { MotionSpinner } from "../../MotionSpinner";

export interface SettingsStoresSectionProps {
  settings: Settings;
  showAll: boolean;
}

/**
 * Stores section: the game accounts OpenNOW can link and sync.
 *
 * Split out of the Account section, which had grown to cover persistent
 * storage, store connections and subscription at once. The desktop build keeps
 * these as separate pages too (Account / Stores / Subscription).
 */
export function SettingsStoresSection({
  settings,
  showAll,
}: SettingsStoresSectionProps): JSX.Element {
  const { t } = useTranslation();
  const [gameAccounts, setGameAccounts] = useState<GameAccountConnection[]>([]);
  const [gameAccountsLoading, setGameAccountsLoading] = useState(true);
  const [gameAccountsError, setGameAccountsError] = useState<string | null>(null);
  const [gameAccountStatusMessage, setGameAccountStatusMessage] = useState<string | null>(null);
  const [gameAccountBusy, setGameAccountBusy] = useState<{
    provider: string;
    action: GameAccountBusyAction;
  } | null>(null);

  const loadGameAccounts = useCallback(async (isCancelled: () => boolean = () => false): Promise<void> => {
    setGameAccountsLoading(true);
    setGameAccountsError(null);
    setGameAccountStatusMessage(null);

    try {
      const result = await window.openNow.fetchGameAccountConnections();
      if (!isCancelled()) {
        setGameAccounts(result.accounts);
      }
    } catch (error) {
      console.warn("[Settings] Failed to fetch game account connections:", error);
      if (!isCancelled()) {
        setGameAccounts([]);
        setGameAccountsError(
          error instanceof Error && error.message.includes("No authenticated session")
            ? t("settings.accountConnections.signInRequired")
            : t("settings.accountConnections.loadFailed"),
        );
      }
    } finally {
      if (!isCancelled()) {
        setGameAccountsLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void loadGameAccounts(() => cancelled);
    return () => { cancelled = true; };
  }, [loadGameAccounts]);

  const handleGameAccountAction = useCallback(async (
    account: GameAccountConnection,
    action: GameAccountBusyAction,
  ): Promise<void> => {
    if (gameAccountBusy) {
      return;
    }

    if (
      action === "unlink" &&
      !window.confirm(t("settings.accountConnections.unlinkConfirm", { provider: account.label }))
    ) {
      return;
    }

    setGameAccountBusy({ provider: account.provider, action });
    setGameAccountStatusMessage(null);
    setGameAccountsError(null);

    try {
      const payload = {
        provider: account.provider,
        proxyUrl: settings.sessionProxyEnabled ? settings.sessionProxyUrl.trim() || undefined : undefined,
      };
      const result =
        action === "link"
          ? await window.openNow.linkGameAccount(payload)
          : action === "unlink"
            ? await window.openNow.unlinkGameAccount(payload)
            : await window.openNow.resyncGameAccount(payload);
      setGameAccounts(result.accounts);
      setGameAccountStatusMessage(
        result.message ??
        (action === "link"
          ? t("settings.accountConnections.linkSuccess", { provider: account.label })
          : action === "unlink"
            ? t("settings.accountConnections.unlinkSuccess", { provider: account.label })
            : t("settings.accountConnections.resyncSuccess", { provider: account.label })),
      );
    } catch (error) {
      console.error(`[Settings] Game account ${action} failed:`, error);
      setGameAccountsError(
        error instanceof Error && error.message
          ? error.message
          : t("settings.accountConnections.actionFailed"),
      );
    } finally {
      setGameAccountBusy(null);
    }
  }, [gameAccountBusy, settings.sessionProxyEnabled, settings.sessionProxyUrl, t]);

  const renderGameAccountCard = useCallback((account: GameAccountConnection) => {
    const busyAction = gameAccountBusy?.provider === account.provider ? gameAccountBusy.action : null;
    const isBusy = Boolean(gameAccountBusy);
    const syncDateLabel = formatGameAccountSyncDate(account.syncDate);
    const statusLabel =
      account.status === "expired"
        ? t("settings.accountConnections.statusExpired")
        : account.status === "sync_error"
          ? t("settings.accountConnections.statusSyncError")
          : account.isConnected
            ? t("settings.accountConnections.statusConnected")
            : t("settings.accountConnections.statusNotConnected");
    const statusClass =
      account.status === "expired" || account.status === "sync_error"
        ? "settings-inline-badge--updater-error"
        : account.isConnected
          ? "settings-inline-badge--codec-gpu"
          : "settings-inline-badge--codec-testing";
    const canLink = account.supportsLinking && (!account.isConnected || account.status === "expired");
    const canUnlink = account.isConnected && account.status !== "expired";
    const canSyncOnly = account.supportsSync && !account.supportsLinking && !account.isConnected;
    const primaryAction: GameAccountBusyAction =
      canUnlink ? "unlink" : canLink ? "link" : "resync";
    const primaryLabel =
      primaryAction === "unlink"
        ? t("settings.accountConnections.unlink")
        : primaryAction === "resync"
          ? t("settings.accountConnections.sync")
          : account.status === "expired"
            ? t("settings.accountConnections.reconnect")
            : t("settings.accountConnections.connect");
    const primaryIcon =
      primaryAction === "unlink"
        ? <Trash2 size={15} />
        : primaryAction === "resync"
          ? <RefreshCcw size={15} />
          : <ExternalLink size={15} />;
    const hasPrimaryAction = canUnlink || canLink || canSyncOnly;

    return (
      <div key={account.provider} className="settings-game-account-card">
        <div className="settings-game-account-main">
          <div className="settings-game-account-icon">
            {account.iconUrl ? (
              <img src={account.iconUrl} alt="" loading="lazy" />
            ) : (
              <Users size={18} />
            )}
          </div>
          <div className="settings-game-account-copy">
            <div className="settings-game-account-title-row">
              <h3>{account.label}</h3>
              <span className={`settings-inline-badge settings-inline-badge--codec ${statusClass}`}>
                {statusLabel}
              </span>
            </div>
            <p>
              {account.isConnected
                ? account.displayName || t("settings.accountConnections.connectedAccount")
                : account.supportsSync && !account.supportsLinking
                  ? t("settings.accountConnections.syncOnlyDescription")
                  : t("settings.accountConnections.notConnectedDescription")}
            </p>
            <div className="settings-game-account-features">
              {account.supportsLinking && <span>{t("settings.accountConnections.ssoSupported")}</span>}
              {account.supportsSync && <span>{t("settings.accountConnections.syncSupported")}</span>}
              {account.isRequired && <span>{t("settings.accountConnections.requiredForSomeGames")}</span>}
            </div>
            {account.supportsSync && account.isConnected ? (
              <p className="settings-game-account-sync">
                {account.syncState === "SYNC_SUCCESS"
                  ? t("settings.accountConnections.syncSummary", {
                    count: account.syncedGames,
                    date: syncDateLabel ?? t("settings.accountConnections.recently"),
                  })
                  : t("settings.accountConnections.syncState", {
                    state: account.syncState ?? t("settings.accountConnections.syncUnknown"),
                  })}
              </p>
            ) : null}
          </div>
        </div>
        <div className="settings-game-account-actions">
          {account.supportsSync && account.isConnected ? (
            <button
              type="button"
              className="settings-chip settings-game-account-action"
              disabled={isBusy}
              onClick={() => {
                void handleGameAccountAction(account, "resync");
              }}
            >
              {busyAction === "resync" ? <MotionSpinner size={15} label={t("settings.accountConnections.resyncing")} /> : <RefreshCcw size={15} />}
              {busyAction === "resync"
                ? t("settings.accountConnections.resyncing")
                : t("settings.accountConnections.resync")}
            </button>
          ) : null}
          {hasPrimaryAction ? (
            <button
              type="button"
              className={`settings-game-account-action ${
                primaryAction === "unlink" ? "settings-delete-cache-btn" : "settings-chip"
              }`}
              disabled={isBusy}
              onClick={() => {
                void handleGameAccountAction(account, primaryAction);
              }}
            >
              {busyAction === primaryAction ? <MotionSpinner size={15} label={t("settings.accountConnections.updating")} /> : primaryIcon}
              {busyAction === primaryAction
                ? primaryAction === "unlink"
                  ? t("settings.accountConnections.unlinking")
                  : primaryAction === "resync"
                    ? t("settings.accountConnections.syncing")
                    : t("settings.accountConnections.connecting")
                : primaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    );
  }, [gameAccountBusy, handleGameAccountAction, t]);

  return (
  <section className="settings-section settings-game-accounts-section">
    {showAll && <div className="settings-section-context">{t("settings.sections.stores")}</div>}
    <div className="settings-section-header settings-section-header--with-copy settings-game-accounts-header">
      <Users size={18} />
      <div>
        <h2>{t("settings.accountConnections.title")}</h2>
        <p className="settings-section-subtitle">{t("settings.accountConnections.description")}</p>
      </div>
      <button
        type="button"
        className="settings-chip settings-game-account-refresh"
        disabled={gameAccountsLoading || Boolean(gameAccountBusy)}
        onClick={() => {
          void loadGameAccounts();
        }}
      >
        {gameAccountsLoading ? <MotionSpinner size={15} label={t("accessibility.refreshingAccounts")} /> : <RefreshCcw size={15} />}
        {t("settings.accountConnections.refresh")}
      </button>
    </div>
    <div className="settings-game-accounts-card">
      {gameAccountsError ? (
        <div className="settings-game-account-state settings-game-account-state--error">
          <AlertTriangle size={16} />
          <span>{gameAccountsError}</span>
        </div>
      ) : null}
      {gameAccountStatusMessage ? (
        <div className="settings-game-account-state settings-game-account-state--success">
          <Check size={16} />
          <span>{gameAccountStatusMessage}</span>
        </div>
      ) : null}
      {gameAccountsLoading ? (
        <div className="settings-game-account-state settings-game-account-state--muted">
          <MotionSpinner size={16} />
          <span>{t("settings.accountConnections.loading")}</span>
        </div>
      ) : gameAccounts.length > 0 ? (
        <div className="settings-game-account-grid">
          {gameAccounts.map((account) => renderGameAccountCard(account))}
        </div>
      ) : (
        <div className="settings-game-account-state settings-game-account-state--muted">
          <Users size={16} />
          <span>{t("settings.accountConnections.empty")}</span>
        </div>
      )}
    </div>
  </section>
  );
}
