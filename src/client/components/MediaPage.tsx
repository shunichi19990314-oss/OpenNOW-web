import { Download, Film, Image as ImageIcon, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { AnimatePresence, m } from "motion/react";

import type { RecordingEntry, ScreenshotEntry } from "@shared/gfn";

import { useTranslation } from "../i18n";
import {
  filterMediaItems,
  formatMediaDuration,
  formatMediaSize,
  toMediaItems,
  type MediaFilter,
  type MediaItem,
} from "../lib/mediaLibrary";
import { pageTransition } from "./MotionProvider";
import { MotionSpinner } from "./MotionSpinner";

/**
 * Captures page, ported from the desktop client's Media screen.
 *
 * Screenshots and recordings already existed behind the in-stream sidebar, but
 * that sidebar disappears with the session, so a capture was effectively lost
 * once the stream ended. This page gives them a permanent home with the same
 * actions the desktop build offers: open, save, delete.
 */
export function MediaPage(): JSX.Element {
  const { t } = useTranslation();
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);

  const load = useCallback(async (isCancelled: () => boolean = () => false): Promise<void> => {
    setLoading(true);
    setError(false);
    try {
      const [nextScreenshots, nextRecordings] = await Promise.all([
        window.openNow.listScreenshots(),
        window.openNow.listRecordings(),
      ]);
      if (isCancelled()) return;
      setScreenshots(nextScreenshots);
      setRecordings(nextRecordings);
    } catch (loadError) {
      console.warn("[Media] Failed to load captures:", loadError);
      if (!isCancelled()) setError(true);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const items = useMemo(() => toMediaItems(screenshots, recordings), [recordings, screenshots]);
  const visibleItems = useMemo(() => filterMediaItems(items, filter), [filter, items]);

  const handleDelete = useCallback(async (item: MediaItem): Promise<void> => {
    setPendingDelete(null);
    try {
      if (item.kind === "screenshot") {
        await window.openNow.deleteScreenshot({ id: item.id.replace(/^screenshot:/, "") });
        setScreenshots((previous) => previous.filter((entry) => `screenshot:${entry.id}` !== item.id));
      } else {
        await window.openNow.deleteRecording({ id: item.id.replace(/^recording:/, "") });
        setRecordings((previous) => previous.filter((entry) => `recording:${entry.id}` !== item.id));
      }
    } catch (deleteError) {
      console.warn("[Media] Failed to delete capture:", deleteError);
      setError(true);
    }
  }, []);

  const handleSave = useCallback(async (item: MediaItem): Promise<void> => {
    try {
      if (item.kind === "screenshot") {
        await window.openNow.saveScreenshotAs({ id: item.id.replace(/^screenshot:/, "") });
        return;
      }
      // Recordings are already a blob URL in browser mode; an anchor click is
      // the same download path the screenshot API uses.
      const anchor = document.createElement("a");
      anchor.href = item.filePath;
      anchor.download = item.fileName;
      anchor.click();
    } catch (saveError) {
      console.warn("[Media] Failed to save capture:", saveError);
      setError(true);
    }
  }, []);

  const counts = {
    all: items.length,
    screenshot: items.filter((item) => item.kind === "screenshot").length,
    recording: items.filter((item) => item.kind === "recording").length,
  };

  const filters: Array<{ id: MediaFilter; label: string; count: number }> = [
    { id: "all", label: t("media.filterAll"), count: counts.all },
    { id: "screenshot", label: t("media.kindScreenshot"), count: counts.screenshot },
    { id: "recording", label: t("media.kindRecording"), count: counts.recording },
  ];

  return (
    <div className="media-page">
      <header className="media-toolbar">
        <div className="media-title">
          <Film size={20} className="media-title-icon" aria-hidden="true" />
          <h1>{t("media.title")}</h1>
        </div>
        <div className="media-filters" role="group" aria-label={t("media.title")}>
          {filters.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`media-filter-chip${filter === option.id ? " media-filter-chip--active" : ""}`}
              onClick={() => setFilter(option.id)}
              aria-pressed={filter === option.id}
            >
              {option.label}
              <span className="media-filter-count">{option.count}</span>
            </button>
          ))}
        </div>
      </header>

      <p className="media-subtitle">{t("media.subtitle")}</p>

      {loading ? (
        <div className="media-empty-state">
          <MotionSpinner size={36} label={t("common.loading")} />
          <p>{t("media.loading")}</p>
        </div>
      ) : error ? (
        <div className="media-empty-state">
          <ImageIcon size={40} className="media-empty-icon" aria-hidden="true" />
          <h3>{t("media.loadFailed")}</h3>
          <button type="button" className="media-retry" onClick={() => void load()}>
            {t("app.actions.retry")}
          </button>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="media-empty-state">
          <ImageIcon size={40} className="media-empty-icon" aria-hidden="true" />
          <h3>{items.length === 0 ? t("media.emptyTitle") : t("media.emptyFilterTitle")}</h3>
          <p>{items.length === 0 ? t("media.emptyBody") : t("media.emptyFilterBody")}</p>
        </div>
      ) : (
        <div className="media-grid">
          <AnimatePresence initial={false}>
            {visibleItems.map((item) => {
              const duration = formatMediaDuration(item.durationMs);
              return (
                <m.article
                  key={item.id}
                  className="media-card"
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={pageTransition}
                >
                  <a
                    className="media-card-thumb"
                    href={item.filePath}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("media.openCapture", { name: item.fileName })}
                  >
                    {item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="media-card-thumb-placeholder" aria-hidden="true">
                        {item.kind === "recording" ? <Film size={26} /> : <ImageIcon size={26} />}
                      </span>
                    )}
                    <span className={`media-card-kind media-card-kind--${item.kind}`}>
                      {item.kind === "recording" ? t("media.kindRecording") : t("media.kindScreenshot")}
                    </span>
                    {duration && <span className="media-card-duration">{duration}</span>}
                  </a>
                  <div className="media-card-meta">
                    <span className="media-card-name" title={item.fileName}>{item.fileName}</span>
                    <span className="media-card-detail">
                      {formatMediaSize(item.sizeBytes)}
                      {item.gameTitle ? ` · ${item.gameTitle}` : ""}
                    </span>
                  </div>
                  <div className="media-card-actions">
                    <button
                      type="button"
                      className="media-card-action"
                      onClick={() => void handleSave(item)}
                      title={t("media.save")}
                      aria-label={t("media.save")}
                    >
                      <Download size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="media-card-action media-card-action--danger"
                      onClick={() => setPendingDelete(item)}
                      title={t("app.actions.delete")}
                      aria-label={t("media.deleteCapture", { name: item.fileName })}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </m.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {pendingDelete && (
          <m.div
            className="collection-dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPendingDelete(null)}
          >
            <m.div
              className="collection-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("media.deleteTitle")}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={pageTransition}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="collection-dialog-header">
                <h2>{t("media.deleteTitle")}</h2>
              </div>
              <p className="collection-dialog-description">
                {t("media.deleteConfirm", { name: pendingDelete.fileName })}
              </p>
              <div className="collection-dialog-actions">
                <button type="button" className="collection-dialog-cancel" onClick={() => setPendingDelete(null)}>
                  {t("app.actions.cancel")}
                </button>
                <button
                  type="button"
                  className="collection-dialog-submit"
                  onClick={() => void handleDelete(pendingDelete)}
                >
                  {t("app.actions.delete")}
                </button>
              </div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
