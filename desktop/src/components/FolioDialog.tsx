import { useEffect, useRef } from "react";
import { FolioButton } from "./FolioButton";
import { FolioIcons } from "./FolioIcons";
import { focusFirstIn, trapTabKey } from "./focusTrap";

interface FolioDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Optional trailing actions (Confirm/Cancel style). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/** Centered dialog for confirmations & consent (03 §5.4): raised surface, r24,
 * scrim, ESC/backdrop close, focus-trapped, actions row. */
export function FolioDialog({ open, onClose, title, actions, children }: FolioDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    focusFirstIn(dialog);
    const prevActive = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      trapTabKey(dialog, e);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prevActive?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="folio-overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        className="folio-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(e) => trapTabKey(dialogRef.current!, e.nativeEvent)}
      >
        {title && <h2 className="folio-dialog__title">{title}</h2>}
        <div className="folio-dialog__content">{children}</div>
        {actions && <div className="folio-dialog__actions">{actions}</div>}
        <button
          type="button"
          className="folio-iconbtn"
          onClick={onClose}
          aria-label="Close dialog"
          style={{ position: "absolute", top: 8, right: 8 }}
        >
          <FolioIcons.Close size="sm" />
        </button>
      </div>
    </>
  );
}

/** Convenience confirm/cancel action pair. */
export function FolioDialogActions({
  confirmLabel,
  onConfirm,
  cancelLabel = "Cancel",
  onCancel,
  danger = false,
}: {
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <>
      <FolioButton variant="secondary" onClick={onCancel}>
        {cancelLabel}
      </FolioButton>
      <FolioButton
        variant="primary"
        onClick={onConfirm}
        className={danger ? "folio-btn--solid-danger" : undefined}
      >
        {confirmLabel}
      </FolioButton>
    </>
  );
}
