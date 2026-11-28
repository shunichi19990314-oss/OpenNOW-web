import type { Settings } from "@shared/gfn";

/**
 * Portable settings backup.
 *
 * Everything the visitor tunes — video, input bindings, interface, AI, plus the
 * favourites/hidden lists and their own collections — lives in this browser's
 * `localStorage`. Clearing site data, switching machines, or trying a different
 * server therefore used to mean rebuilding all of it by hand.
 *
 * The backup is a single JSON document: versioned, tagged with the exporting
 * account and time, and merged on restore rather than overwritten. Restoring
 * must never be a way to lose work, so:
 *
 * - unknown or unreadable files are rejected with a reason, not a silent no-op;
 * - keys that do not exist in the current build are dropped (a backup from a
 *   newer build must not inject settings this one cannot render);
 * - restoring over an existing file requires the explicit overwrite mode the
 *   UI offers, otherwise only what the file names is applied.
 */

export const SETTINGS_BACKUP_FORMAT = "opennow.settings-backup";
export const SETTINGS_BACKUP_VERSION = 1;

export interface SettingsBackupDocument {
  format: typeof SETTINGS_BACKUP_FORMAT;
  version: typeof SETTINGS_BACKUP_VERSION;
  /** Who exported it; informational, and shown before restoring. */
  exportedBy?: string;
  exportedAt: string;
  /** Only the keys that differ from the defaults are written. */
  settings: Partial<Settings>;
}

export type SettingsBackupParseError = "notJson" | "notBackup" | "unsupportedVersion" | "empty";

export type ParseSettingsBackupResult =
  | { ok: true; document: SettingsBackupDocument }
  | { ok: false; error: SettingsBackupParseError };

/** Settings that are device-specific and must never travel between machines. */
const DEVICE_LOCAL_KEYS: ReadonlyArray<keyof Settings> = [
  "nativeStreamerExecutablePath",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Keep only the keys the current build knows about, and only those that differ
 * from the defaults. Values are taken as-is: `Settings` is a flat map of
 * primitives, arrays of strings and a couple of small records, and every
 * consumer already normalises what it reads (the same path a hand-edited
 * `localStorage` entry goes through).
 */
export function pickBackupSettings(
  settings: Settings,
  defaults: Settings,
): Partial<Settings> {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(defaults) as Array<keyof Settings>) {
    if (DEVICE_LOCAL_KEYS.includes(key)) continue;
    const value = settings[key];
    if (value === undefined) continue;
    const isDefault = JSON.stringify(value) === JSON.stringify(defaults[key]);
    if (isDefault) continue;
    picked[key] = value;
  }
  return picked as Partial<Settings>;
}

export function createSettingsBackup(
  settings: Settings,
  defaults: Settings,
  options: { exportedBy?: string; now?: Date } = {},
): SettingsBackupDocument {
  const exportedBy = options.exportedBy?.trim();
  return {
    format: SETTINGS_BACKUP_FORMAT,
    version: SETTINGS_BACKUP_VERSION,
    ...(exportedBy ? { exportedBy } : {}),
    exportedAt: (options.now ?? new Date()).toISOString(),
    settings: pickBackupSettings(settings, defaults),
  };
}

export function serializeSettingsBackup(document: SettingsBackupDocument): string {
  return JSON.stringify(document, null, 2);
}

/** `opennow-settings-2026-11-12.json`; date-only so the name sorts helpfully. */
export function settingsBackupFileName(now: Date = new Date()): string {
  const iso = now.toISOString().slice(0, 10);
  return `opennow-settings-${iso}.json`;
}

export function parseSettingsBackup(text: string, defaults: Settings): ParseSettingsBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "notJson" };
  }
  if (!isPlainObject(parsed) || parsed.format !== SETTINGS_BACKUP_FORMAT) {
    return { ok: false, error: "notBackup" };
  }
  if (parsed.version !== SETTINGS_BACKUP_VERSION) {
    return { ok: false, error: "unsupportedVersion" };
  }
  if (!isPlainObject(parsed.settings) || Object.keys(parsed.settings).length === 0) {
    return { ok: false, error: "empty" };
  }

  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.settings)) {
    if (!(key in defaults)) continue;
    if (DEVICE_LOCAL_KEYS.includes(key as keyof Settings)) continue;
    if (value === undefined) continue;
    settings[key] = value;
  }
  if (Object.keys(settings).length === 0) {
    return { ok: false, error: "empty" };
  }

  const exportedAt = typeof parsed.exportedAt === "string" ? parsed.exportedAt : "";
  const exportedBy = typeof parsed.exportedBy === "string" ? parsed.exportedBy.trim() : "";
  return {
    ok: true,
    document: {
      format: SETTINGS_BACKUP_FORMAT,
      version: SETTINGS_BACKUP_VERSION,
      ...(exportedBy ? { exportedBy } : {}),
      exportedAt,
      settings: settings as Partial<Settings>,
    },
  };
}

/**
 * Build the settings to apply on restore.
 *
 * Merge is the default: the file's values win for the keys it names, everything
 * else keeps the current value. Overwrite starts from the defaults, so a
 * leftover setting from this browser cannot survive a "replace everything".
 */
export function applySettingsBackup(
  current: Settings,
  backup: Partial<Settings>,
  defaults: Settings,
  mode: "merge" | "overwrite" = "merge",
): Settings {
  const base = mode === "overwrite" ? defaults : current;
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(backup)) {
    if (!(key in defaults)) continue;
    if (DEVICE_LOCAL_KEYS.includes(key as keyof Settings)) continue;
    if (value === undefined) continue;
    next[key] = value;
  }
  return next as unknown as Settings;
}

/** One-line description for the restore confirmation. */
export function describeSettingsBackup(
  document: SettingsBackupDocument,
  labels: { keys: (count: number) => string; account?: string; unknownDate: string },
): string {
  const count = Object.keys(document.settings).length;
  const parts = [labels.keys(count)];
  if (document.exportedBy) {
    parts.push(labels.account ? labels.account.replace("{account}", document.exportedBy) : document.exportedBy);
  }
  parts.push(document.exportedAt ? document.exportedAt.slice(0, 10) : labels.unknownDate);
  return parts.join(" · ");
}
