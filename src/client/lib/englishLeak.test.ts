import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import ja from "../../../locales/ja.json";
import en from "../../../locales/en.json";

/**
 * Guard against English leaking back into the Japanese UI.
 *
 * The in-stream sidebar was fully hard-coded English ("Video Filters",
 * "Mouse Preferences", "Keep Playing" in the exit dialog, the screenshot and
 * recording errors) while every neighbouring panel was translated, which is
 * exactly the "まだ微妙に英語が残っている" report. Strings that reach the screen
 * must go through `t()` and live in `locales/ja.json`.
 *
 * The files are parsed with the TypeScript compiler rather than a regex: `>`
 * and `<` appear everywhere in TSX (arrow functions, generics, comparisons),
 * and a pattern-based scan reports hundreds of false positives.
 */

const clientRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * Key caps, product names and acronyms are printed as-is in every locale.
 * Anything else in a JSX text node is untranslated prose.
 */
const ALLOWED_WORDS = new Set([
  "Enter", "Esc", "Tab", "Shift", "Ctrl", "Alt", "Space", "Backspace", "Delete", "Meta",
  "A", "B", "LB", "RB", "L1", "R1", "L2", "R2", "X", "Y",
  "HDR", "REC", "AI", "ON", "OFF", "ID", "OK",
  "OpenNOW", "PrintedWaste", "NVIDIA", "GeForce", "NOW", "GitHub", "Discord", "Steam",
  "Xbox", "macOS", "Windows", "Linux", "AppImage", "Chromium", "Electron",
  "DirectX", "WebRTC", "GStreamer", "NVST", "L4S", "H265", "AV1", "VP9", "H264",
  "FPS", "GPU", "CPU", "RTT", "JB", "Mbps", "GB", "MB", "KB", "ms", "URL", "VPC",
  "SSO", "IPC", "TV", "Anti", "AFK", "View", "Menu", "SDR", "D3D11", "D3D12",
  "LT", "RT", "LS", "RS", "Mic",
  // Badge lettering: the on-screen label stays as a badge, the meaning lives in
  // the translated `title`/`aria-label` beside it.
  "ANTI-AFK",
]);

/** Words that are legitimately untranslated but appear inside prose. */
const ALLOWED_INLINE = new Set([...ALLOWED_WORDS, "G-Sync", "Numes", "Zortos", "Render"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function latinWords(text: string): string[] {
  return (text.match(/[A-Za-z][A-Za-z0-9'’_-]*/g) ?? []);
}

function offendingProse(text: string): boolean {
  const words = latinWords(text);
  if (words.length === 0) return false;
  const unknown = words.filter((word) => !ALLOWED_INLINE.has(word) && !ALLOWED_WORDS.has(word));
  if (unknown.length === 0) return false;
  // Single letters ("D", "R", "x") and two-letter tokens ("JB", "IQ") are
  // stat labels, not copy; anything longer is prose that needs translating.
  if (unknown.some((word) => word.length >= 4)) return true;
  return unknown.length >= 2 && words.length >= 2;
}

/** URLs, file paths and host:port examples are not translatable copy. */
function isNotCopy(text: string): boolean {
  return /^(?:https?:\/\/|www\.)/.test(text) || /^[\w.-]+\.[a-z]{2,}\/\S*$/.test(text);
}

interface Problem {
  file: string;
  detail: string;
}

function scan(source: string, file: string): Problem[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: Problem[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      // A lone punctuation/entity node such as "·" or "/" is layout, not copy.
      if (text && !isNotCopy(text) && offendingProse(text)) {
        problems.push({ file, detail: `text: "${text}"` });
      }
    }

    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sourceFile);
      const value = node.initializer.text;
      if (["aria-label", "placeholder", "title", "alt"].includes(name) && !isNotCopy(value) && offendingProse(value)) {
        problems.push({ file, detail: `${name}: "${value}"` });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return problems;
}

describe("Japanese UI has no hard-coded English", () => {
  const files = walk(clientRoot);

  it("finds the client components it is meant to check", () => {
    // A wrong root silently turns every assertion below into a no-op.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((file) => file.endsWith("StreamView.tsx"))).toBe(true);
  });

  it("routes every visible string through t()", () => {
    const problems = files.flatMap((file) =>
      scan(readFileSync(file, "utf8"), relative(clientRoot, file)),
    );
    expect(problems).toEqual([]);
  });

  it("has a Japanese string for every key the settings and sidebar print", () => {
    const required = [
      "stream.pointerLockHint", "stream.kbdSelect", "stream.kbdBack", "stream.kbdPages",
      "stream.windowed", "stream.capturing", "stream.keyboard", "stream.mousePreferences",
      "stream.mousePreferencesHint", "stream.mouseSensitivityHint", "stream.mouseAccelerationHint",
      "stream.videoFilters", "stream.videoFiltersHint", "stream.enableFilters", "stream.enableFiltersHint",
      "stream.resetFilters", "stream.microphoneMode", "stream.micSendLevelHint", "stream.micNotActive",
      "stream.screenshotKey", "stream.capture", "stream.recordingKey", "stream.codec",
      "stream.recordingBitrate", "stream.auto", "stream.recordingWithElapsed", "stream.record",
      "stream.stop", "stream.start", "stream.noScreenshotsYet", "stream.noRecordingsYet",
      "stream.shortcutBindings", "stream.shortcutPlaceholder", "stream.toggleStats", "stream.mouseLock",
      "stream.stopStream", "stream.toggleMicrophone", "stream.toggleSidebar", "stream.screenshotPreview",
      "stream.screenshotAlt", "stream.connectingToStream", "stream.connectingTo", "stream.settingUp",
      "stream.timeLeft", "stream.antiAfkOn", "stream.antiAfkOff", "stream.statsLabel",
      "stream.shortcutEmpty", "stream.shortcutInvalid", "stream.shortcutConflict",
      "stream.galleryApiUnavailable", "stream.galleryLoadFailed", "stream.captureApiUnavailable",
      "stream.notReadyForScreenshots", "stream.screenshotFailed", "stream.screenshotDeleteFailed",
      "stream.screenshotSaveFailed", "stream.recordingsLoadFailed", "stream.recordingDeleteFailed",
      "stream.recordingApiUnavailable", "stream.notReadyForRecording", "stream.recordingStartFailed",
      "stream.recordingSaveFailed", "stream.recordingError",
      "session.exitPromptPrefix", "session.exitPromptSuffix", "session.keepPlaying",
      "session.exitStreamConfirm",
      "settings.input.conflictsWithSidebarToggle", "settings.input.conflictsWithAnotherBinding",
      "settings.audio.permissionUnavailable", "settings.audio.permissionDeniedRetry",
      "settings.audio.devicesUnavailable", "settings.nativeStreamer.autoBackendDescription",
      "settings.nativeStreamer.directx11Description", "settings.nativeStreamer.directx12Description",
      "settings.thanks.loadFailed", "app.units.lessThanMinute", "app.units.hoursMinutes",
      // Raw GeForce NOW enums and the server's unknown-store placeholder.
      "library.playType.freeToPlay", "library.playType.installToPlay",
      "library.playType.readyToPlay", "library.playType.premium", "library.playType.subscription",
      "library.playability.playable", "library.playability.available",
      "library.playability.unavailable", "library.playability.maintenance",
      "library.playability.comingSoon",
      "library.controlLabels.keyboard", "library.controlLabels.mouse",
      "library.controlLabels.keyboardMouse", "library.controlLabels.gamepad",
      "library.controlLabels.touch",
      "library.cloudStore", "gameCard.unknownStore",
      "stream.stats.notAvailable", "stream.stats.notMeasured",
      "sidebar.untitledRecording", "settings.thanks.privateSupporterName",
    ];
    const read = (tree: Record<string, unknown>, key: string): unknown =>
      key.split(".").reduce<unknown>(
        (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
        tree,
      );

    expect(required.filter((key) => typeof read(ja, key) !== "string")).toEqual([]);
    expect(required.filter((key) => typeof read(en, key) !== "string")).toEqual([]);
  });

  it("does not render an enum-shaped literal inside JSX", () => {
    // `FREE_TO_PLAY`, `INSTALL_TO_PLAY`, `SYNC_SUCCESS` … are API tokens, not
    // copy. Ternaries like `{status === "SYNC_SUCCESS" ? … }` are fine; what is
    // not fine is a token that *is* the rendered value, e.g.
    // `{game.playType ?? "FREE_TO_PLAY"}` or `{error.code || "UNKNOWN"}`.
    const enumLiteral = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
    const problems: Problem[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      const checkRendered = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) && enumLiteral.test(node.text)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          problems.push({
            file: `${relative(clientRoot, file)}:${line + 1}`,
            detail: `rendered enum "${node.text}"`,
          });
        }
      };

      const visit = (node: ts.Node): void => {
        if (ts.isJsxExpression(node) && node.expression) {
          const expression = node.expression;
          checkRendered(expression);
          if (ts.isConditionalExpression(expression)) {
            checkRendered(expression.whenTrue);
            checkRendered(expression.whenFalse);
          }
          if (ts.isBinaryExpression(expression)) {
            checkRendered(expression.left);
            checkRendered(expression.right);
          }
          if (ts.isParenthesizedExpression(expression)) {
            checkRendered(expression.expression);
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(problems).toEqual([]);
  });

  it("has no English-only prose left in the Japanese bundle", () => {
    // Product names ("GitHub Sponsors") are fine; full English sentences are not.
    const allowed = new Set(["settings.thanks.githubSponsors"]);
    const flatten = (tree: Record<string, unknown>, prefix = ""): Array<[string, string]> =>
      Object.entries(tree).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object") {
          return flatten(value as Record<string, unknown>, path);
        }
        return typeof value === "string" ? [[path, value] as [string, string]] : [];
      });

    const japanese = /[\u3040-\u30ff\u4e00-\u9fff]/;
    const offenders = flatten(ja as unknown as Record<string, unknown>)
      .filter(([key, value]) => !allowed.has(key)
        && !japanese.test(value)
        && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(value));

    expect(offenders).toEqual([]);
  });

  it("keeps the two locales key-for-key in sync", () => {
    const flatten = (tree: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(tree).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return value && typeof value === "object"
          ? flatten(value as Record<string, unknown>, path)
          : [path];
      });

    const jaKeys = new Set(flatten(ja as unknown as Record<string, unknown>));
    const enKeys = new Set(flatten(en as unknown as Record<string, unknown>));
    // A key present in one bundle but not the other renders as the raw dotted
    // key (or English) for that locale, so the sets must match exactly.
    expect([...jaKeys].filter((key) => !enKeys.has(key))).toEqual([]);
    expect([...enKeys].filter((key) => !jaKeys.has(key))).toEqual([]);
  });
});
