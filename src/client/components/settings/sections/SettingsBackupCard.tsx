import { Download, FileWarning, RotateCcw, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent, type JSX } from "react";

import type { Settings } from "@shared/gfn";

import { useTranslation } from "../../../i18n";
import {
  applySettingsBackup,
  createSettingsBackup,
  describeSettingsBackup,
  parseSettingsBackup,
  serializeSettingsBackup,
  settingsBackupFileName,
  type SettingsBackupParseError,
} from "../../../lib/settingsBackup";

export interface SettingsBackupCardProps {
  settings: Settings;
  /** The build's defaults, used to write only what was changed. */
  defaults: Settings;
  /** Applies the merged settings (the shell persists + reflects them). */
  onRestore: (settings: Settings) => void;
  /** Account label written into the file, when one is signed in. */
  accountLabel?: string;
}

type RestoreState = "idle" | "applied" | "error";

const ERROR_KEYS: Record<SettingsBackupParseError, string> = {
  notJson: "settings.backup.errors.notJson",
  notBackup: "settings.backup.errors.notBackup",
  unsupportedVersion: "settings.backup.errors.unsupportedVersion",
  empty: "settings.backup.errors.empty",
};

/**
 * Export / restore settings as one JSON file.
 *
 * Settings, favourites, hidden titles and collections all live in this
 * browser's storage, so "clear site data", a new machine or a different server
 * used to mean retuning everything. The export is a plain JSON file the visitor
 * owns; restoring merges it (the file wins for the keys it names) and reports
 * what happened instead of failing silently.
 */
export function SettingsBackupCard({
  settings,
  defaults,
  onRestore,
  accountLabel,
}: SettingsBackupCardProps): JSX.Element {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [restoreState, setRestoreState] = useState<RestoreState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{ text: string; summary: string } | null>(null);

  const handleExport = (): void => {
    const now = new Date();
    const backup = createSettingsBackup(settings, defaults, {
      exportedBy: accountLabel,
      now,
    });
    const blob = new Blob([serializeSettingsBackup(backup)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    // `document` here is the DOM global, not the backup document.
    const link = window.document.createElement("a");
    link.href = url;
    link.download = settingsBackupFileName(now);
    link.rel = "noopener";
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoke on the next tick: Safari aborts the download if the object URL is
    // released while it is still being read.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setRestoreState("idle");
    setMessage(t("settings.backup.exported", { count: Object.keys(backup.settings).length }));
  };

  const handleFileChosen = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    // Clear immediately so choosing the same file twice still fires `change`.
    event.target.value = "";
    if (!file) return;

    const text = await file.text();
    const parsed = parseSettingsBackup(text, defaults);
    if (!parsed.ok) {
      setPendingRestore(null);
      setRestoreState("error");
      setMessage(t(ERROR_KEYS[parsed.error]));
      return;
    }

    const summary = describeSettingsBackup(parsed.document, {
      keys: (count) => t("settings.backup.summaryKeys", { count }),
      account: t("settings.backup.summaryAccount"),
      unknownDate: t("settings.backup.unknownDate"),
    });
    // Restoring changes the whole shell at once, so it is confirmed with the
    // file's own description rather than applied the moment it is picked.
    setPendingRestore({ text, summary });
    setRestoreState("idle");
    setMessage(null);
  };

  const handleConfirmRestore = (): void => {
    if (!pendingRestore) return;
    const parsed = parseSettingsBackup(pendingRestore.text, defaults);
    if (!parsed.ok) {
      setPendingRestore(null);
      setRestoreState("error");
      setMessage(t(ERROR_KEYS[parsed.error]));
      return;
    }
    const next = applySettingsBackup(settings, parsed.document.settings, defaults, "merge");
    onRestore(next);
    setPendingRestore(null);
    setRestoreState("applied");
    setMessage(t("settings.backup.restored", { count: Object.keys(parsed.document.settings).length }));
  };

  return (
    <div className="settings-backup-card">
      <div className="settings-backup-copy">
        <h3>
          <RotateCcw size={16} aria-hidden="true" />
          {t("settings.backup.title")}
        </h3>
        <p>{t("settings.backup.description")}</p>
      </div>

      <div className="settings-backup-actions">
        <button type="button" className="settings-backup-btn" onClick={handleExport}>
          <Download size={16} />
          {t("settings.backup.export")}
        </button>
        <button
          type="button"
          className="settings-backup-btn settings-backup-btn--quiet"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={16} />
          {t("settings.backup.restore")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="settings-backup-file"
          onChange={(event) => { void handleFileChosen(event); }}
        />
      </div>

      {pendingRestore && (
        <div className="settings-backup-confirm" role="group" aria-label={t("settings.backup.confirmTitle")}>
          <p>
            <FileWarning size={14} aria-hidden="true" />
            {t("settings.backup.confirmBody", { summary: pendingRestore.summary })}
          </p>
          <div className="settings-backup-actions">
            <button type="button" className="settings-backup-btn" onClick={handleConfirmRestore}>
              {t("settings.backup.confirm")}
            </button>
            <button
              type="button"
              className="settings-backup-btn settings-backup-btn--quiet"
              onClick={() => setPendingRestore(null)}
            >
              {t("app.actions.cancel")}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className={`settings-backup-message settings-backup-message--${restoreState}`} role="status">
          {message}
        </p>
      )}
    </div>
  );
}
