import { useEffect, useRef, useState, type JSX } from "react";
import { m } from "motion/react";
import { X } from "lucide-react";

import { useTranslation } from "../i18n";
import {
  MAX_COLLECTION_NAME_LENGTH,
  validateCollectionName,
  type CollectionNameError,
  type GameCollection,
} from "../lib/collections";
import { panelSpring } from "./MotionProvider";
import { useEscapeToClose } from "../lib/dialogKeys";

export type CollectionDialogMode = "create" | "rename" | "delete";

interface CollectionDialogProps {
  mode: CollectionDialogMode;
  collections: readonly GameCollection[];
  /** The collection being renamed/deleted. */
  collection?: GameCollection | null;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

const ERROR_KEYS: Record<CollectionNameError, string> = {
  missing: "collections.errors.missing",
  tooLong: "collections.errors.tooLong",
  duplicate: "collections.errors.duplicate",
  limit: "collections.errors.limit",
};

/**
 * Create / rename / delete dialog, ported from `DesktopCollectionDialog.qml`.
 * Validation messages mirror the desktop wording and are shown as soon as the
 * visitor types, not only on submit.
 */
export function CollectionDialog({
  mode,
  collections,
  collection,
  onCancel,
  onSubmit,
}: CollectionDialogProps): JSX.Element {
  const { t } = useTranslation();
  // The input keeps focus, so a window-level Escape handler is what actually
  // receives the key (the dialog itself never takes focus).
  useEscapeToClose(true, onCancel);
  const [name, setName] = useState(collection?.name ?? "");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mode === "delete") return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [mode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const error = mode === "delete" ? null : validateCollectionName(name, collections, collection?.id);
  const canSubmit = mode === "delete" || (error === null && name.trim().length > 0);
  const title = mode === "delete"
    ? t("collections.deleteTitle")
    : mode === "rename"
      ? t("collections.renameTitle")
      : t("collections.newCollection");

  return (
    <m.div
      className="collection-dialog-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <m.div
        className="collection-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={panelSpring}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="collection-dialog-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="collection-dialog-close"
            onClick={onCancel}
            aria-label={t("app.actions.close")}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <p className="collection-dialog-description">
          {mode === "delete"
            ? t("collections.confirmDelete", { name: collection?.name ?? "" })
            : t("collections.description")}
        </p>

        {mode !== "delete" && (
          <label className="collection-dialog-field">
            <span>{t("collections.name")}</span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              maxLength={MAX_COLLECTION_NAME_LENGTH}
              placeholder={t("collections.name")}
              onChange={(event) => {
                setName(event.target.value);
                setTouched(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canSubmit) {
                  event.preventDefault();
                  onSubmit(name.trim());
                }
              }}
              aria-invalid={touched && error !== null}
            />
            <span className="collection-dialog-hint">{t("collections.nameHint", { count: MAX_COLLECTION_NAME_LENGTH })}</span>
            {touched && error && (
              <span className="collection-dialog-error" role="alert">{t(ERROR_KEYS[error])}</span>
            )}
          </label>
        )}

        <div className="collection-dialog-actions">
          <button type="button" className="collection-dialog-cancel" onClick={onCancel}>
            {t("app.actions.cancel")}
          </button>
          <button
            type="button"
            className="collection-dialog-submit"
            disabled={!canSubmit}
            onClick={() => onSubmit(name.trim())}
          >
            {mode === "delete" ? t("collections.delete") : t("collections.save")}
          </button>
        </div>
      </m.div>
    </m.div>
  );
}
