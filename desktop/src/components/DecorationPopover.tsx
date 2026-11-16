import { useEffect, useRef } from "react";
import { FolioIcons } from "./FolioIcons";

export interface DecorationPopoverProps {
  /** viewport coordinates of the click (the popover is position: fixed) */
  x: number;
  y: number;
  /** has a saved note ("Edit note" vs "Add note" wording) */
  hasNote: boolean;
  onEditNote: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * Small popover over a clicked PDF highlight (R5, hardening §12): edit the
 * note or remove the highlight. Mirrors the reduced right-click menu's
 * behaviour — fixed position, outside-mousedown and Escape dismissal.
 */
export function DecorationPopover({
  x,
  y,
  hasNote,
  onEditNote,
  onRemove,
  onClose,
}: DecorationPopoverProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="folio-pdf-decor-popover"
      style={{
        top: y,
        left: Math.min(x, window.innerWidth - 220),
      }}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        className="folio-reader-menu__item"
        onClick={() => {
          onClose();
          onEditNote();
        }}
      >
        <FolioIcons.Notes size="sm" />
        {hasNote ? "Edit note" : "Add note"}
      </button>
      <button
        type="button"
        role="menuitem"
        className="folio-reader-menu__item"
        onClick={() => {
          onClose();
          onRemove();
        }}
      >
        <FolioIcons.Trash size="sm" />
        Remove highlight
      </button>
    </div>
  );
}
