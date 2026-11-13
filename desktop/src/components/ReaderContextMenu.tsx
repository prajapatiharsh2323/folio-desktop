import { useEffect, useRef } from "react";
import { FolioIcons } from "./FolioIcons";

export interface ReaderContextMenuProps {
  /** viewport coordinates of the click (toolbar is position: fixed) */
  x: number;
  y: number;
  onClose: () => void;
  onToggleChrome: () => void;
  onToc: () => void;
  onBookmark: () => void;
}

/**
 * Reduced right-click menu over the reader canvas, no active selection
 * (07 §3): chrome toggle, contents, bookmark. With a selection the selection
 * toolbar's own actions are re-anchored instead (ReaderScreen).
 */
export function ReaderContextMenu({
  x,
  y,
  onClose,
  onToggleChrome,
  onToc,
  onBookmark,
}: ReaderContextMenuProps) {
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
      className="folio-reader-ctxmenu"
      style={{
        top: y,
        left: Math.min(x, window.innerWidth - 250),
      }}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        className="folio-reader-menu__item"
        onClick={() => {
          onClose();
          onToggleChrome();
        }}
      >
        <FolioIcons.EyeOff size="sm" />
        Toggle toolbar
      </button>
      <button
        type="button"
        role="menuitem"
        className="folio-reader-menu__item"
        onClick={() => {
          onClose();
          onToc();
        }}
      >
        <FolioIcons.Toc size="sm" />
        Table of contents
      </button>
      <button
        type="button"
        role="menuitem"
        className="folio-reader-menu__item"
        onClick={() => {
          onClose();
          onBookmark();
        }}
      >
        <FolioIcons.Bookmark size="sm" />
        Bookmark position
      </button>
    </div>
  );
}
