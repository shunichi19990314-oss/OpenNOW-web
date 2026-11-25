/**
 * Media library model for the Captures page.
 *
 * The desktop client has a first-class Captures screen
 * (`qml/screens/MediaScreen.qml`); in the browser the screenshots and
 * recordings already exist behind `window.openNow.listScreenshots()` /
 * `listRecordings()`, but the only way to reach them was the in-stream sidebar,
 * which disappears when the session ends. This module turns both lists into one
 * sortable feed and keeps the formatting testable.
 */
import type { RecordingEntry, ScreenshotEntry } from "@shared/gfn";

export type MediaKind = "screenshot" | "recording";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  fileName: string;
  filePath: string;
  createdAtMs: number;
  sizeBytes: number;
  /** Screenshot data URL, or a recording thumbnail when one was captured. */
  thumbnailUrl?: string;
  /** Recording length; screenshots have none. */
  durationMs?: number;
  gameTitle?: string;
}

export type MediaFilter = "all" | MediaKind;

export function toMediaItems(
  screenshots: readonly ScreenshotEntry[],
  recordings: readonly RecordingEntry[],
): MediaItem[] {
  const items: MediaItem[] = [
    ...screenshots.map((entry) => ({
      id: `screenshot:${entry.id}`,
      kind: "screenshot" as const,
      fileName: entry.fileName,
      filePath: entry.filePath,
      createdAtMs: entry.createdAtMs,
      sizeBytes: entry.sizeBytes,
      thumbnailUrl: entry.dataUrl,
    })),
    ...recordings.map((entry) => ({
      id: `recording:${entry.id}`,
      kind: "recording" as const,
      fileName: entry.fileName,
      filePath: entry.filePath,
      createdAtMs: entry.createdAtMs,
      sizeBytes: entry.sizeBytes,
      thumbnailUrl: entry.thumbnailDataUrl,
      durationMs: entry.durationMs,
      gameTitle: entry.gameTitle,
    })),
  ];
  // Newest first; a stable tie-break keeps the order deterministic when two
  // captures land in the same millisecond (common on a burst).
  return items.sort((left, right) => (
    right.createdAtMs - left.createdAtMs || left.id.localeCompare(right.id)
  ));
}

export function filterMediaItems(items: readonly MediaItem[], filter: MediaFilter): MediaItem[] {
  return filter === "all" ? [...items] : items.filter((item) => item.kind === filter);
}

/** Filter by the game a recording belongs to (screenshots have no game tag). */
export function mediaItemsForGame(items: readonly MediaItem[], gameTitle: string | undefined): MediaItem[] {
  if (!gameTitle) return [...items];
  return items.filter((item) => item.gameTitle === gameTitle);
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** `m:ss` / `h:mm:ss`; deliberately locale-neutral, like the stream overlay. */
export function formatMediaDuration(durationMs: number | undefined): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** `1.4 MB` — binary units, matching the file manager the download lands in. */
export function formatMediaSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 KB";
  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}
