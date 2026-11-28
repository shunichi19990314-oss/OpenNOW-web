import { describe, expect, it } from "vitest";

import type { Settings } from "@shared/gfn";

import { WEB_DEFAULT_SETTINGS } from "../webDefaults";
import {
  applySettingsBackup,
  createSettingsBackup,
  parseSettingsBackup,
  pickBackupSettings,
  serializeSettingsBackup,
  settingsBackupFileName,
} from "./settingsBackup";

/**
 * A backup is the only way to carry a tuned shell to another machine, so a
 * broken file must never half-apply: each rejection path is pinned here, along
 * with the rule that device-specific values (an executable path) do not travel.
 */

const defaults = WEB_DEFAULT_SETTINGS;

function changedSettings(): Settings {
  return {
    ...defaults,
    fps: 120,
    resolution: "2560x1440",
    favoriteGameIds: ["100", "200"],
    hiddenGameIds: ["300"],
    nativeStreamerExecutablePath: "/opt/opennow/streamer",
  };
}

describe("creating a backup", () => {
  it("writes only what differs from the defaults", () => {
    const picked = pickBackupSettings(changedSettings(), defaults);
    expect(picked.fps).toBe(120);
    expect(picked.favoriteGameIds).toEqual(["100", "200"]);
    // Untouched keys stay out so the file survives default changes.
    expect("showStatsOnLaunch" in picked).toBe(false);
  });

  it("never carries the executable path between machines", () => {
    const picked = pickBackupSettings(changedSettings(), defaults);
    expect("nativeStreamerExecutablePath" in picked).toBe(false);
  });

  it("tags the file with the exporter and a stable date", () => {
    const backup = createSettingsBackup(changedSettings(), defaults, {
      exportedBy: "player@example.com",
      now: new Date("2026-11-12T09:30:00Z"),
    });
    expect(backup.format).toBe("opennow.settings-backup");
    expect(backup.version).toBe(1);
    expect(backup.exportedBy).toBe("player@example.com");
    expect(backup.exportedAt).toBe("2026-11-12T09:30:00.000Z");
    expect(settingsBackupFileName(new Date("2026-11-12T09:30:00Z"))).toBe("opennow-settings-2026-11-12.json");
  });
});

describe("parsing a backup", () => {
  const text = serializeSettingsBackup(createSettingsBackup(changedSettings(), defaults));

  it("round-trips a real export", () => {
    const parsed = parseSettingsBackup(text, defaults);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.settings.fps).toBe(120);
  });

  it("rejects a file that is not JSON", () => {
    expect(parseSettingsBackup("{ not json", defaults)).toEqual({ ok: false, error: "notJson" });
  });

  it("rejects JSON from something else", () => {
    expect(parseSettingsBackup(JSON.stringify({ hello: "world" }), defaults))
      .toEqual({ ok: false, error: "notBackup" });
  });

  it("rejects a newer format instead of guessing", () => {
    const future = JSON.stringify({ format: "opennow.settings-backup", version: 99, settings: { fps: 60 } });
    expect(parseSettingsBackup(future, defaults)).toEqual({ ok: false, error: "unsupportedVersion" });
  });

  it("reports an empty payload", () => {
    expect(parseSettingsBackup(JSON.stringify({ format: "opennow.settings-backup", version: 1, settings: {} }), defaults))
      .toEqual({ ok: false, error: "empty" });
  });

  it("drops keys this build does not know", () => {
    const future = JSON.stringify({
      format: "opennow.settings-backup",
      version: 1,
      exportedAt: "2026-11-12T00:00:00.000Z",
      settings: { fps: 60, someFutureSetting: true },
    });
    const parsed = parseSettingsBackup(future, defaults);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("someFutureSetting" in parsed.document.settings).toBe(false);
    expect(parsed.document.settings.fps).toBe(60);
  });
});

describe("applying a backup", () => {
  it("merges: named keys win, the rest is left alone", () => {
    const current: Settings = { ...defaults, fps: 30, posterSizeScale: 1.4 };
    const next = applySettingsBackup(current, { fps: 120 }, defaults, "merge");
    expect(next.fps).toBe(120);
    // Untouched keys keep the current value.
    expect(next.posterSizeScale).toBe(1.4);
  });

  it("overwrite starts from the defaults so nothing stale survives", () => {
    const current: Settings = { ...defaults, fps: 30, posterSizeScale: 1.4 };
    const next = applySettingsBackup(current, { fps: 120 }, defaults, "overwrite");
    expect(next.fps).toBe(120);
    expect(next.posterSizeScale).toBe(defaults.posterSizeScale);
  });

  it("ignores unknown and device-local keys on restore", () => {
    const current: Settings = { ...defaults };
    const next = applySettingsBackup(
      current,
      { nativeStreamerExecutablePath: "/evil/path", bogus: 1 } as Partial<Settings>,
      defaults,
    );
    expect(next.nativeStreamerExecutablePath).toBe(defaults.nativeStreamerExecutablePath);
    expect("bogus" in next).toBe(false);
  });
});
