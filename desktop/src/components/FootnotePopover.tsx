import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FolioIcons } from "./FolioIcons";
import type { NoterefActivation } from "../reader/ReaderEngine";

export interface FootnotePopoverProps {
  activation: NoterefActivation;
  onClose: () => void;
}

const POPOVER_WIDTH = 340;
const POPOVER_MAX_HEIGHT = 320;
const VIEWPORT_GAP = 12;

/**
 * Noteref footnote popover (R4 2.2b, 04 §2): shows the footnote body beside
 * the reference without navigating. Dismissed by Escape, an outside pointer
 * press, the close button — or simply tapping the same noteref again is not
 * needed since a new activation replaces the content.
 */
export function FootnotePopover({ activation, onClose }: FootnotePopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Place beside the reference point, clamped to the viewport (fixed overlay).
  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(
      Math.max(VIEWPORT_GAP, activation.x + 16),
      Math.max(VIEWPORT_GAP, vw - POPOVER_WIDTH - VIEWPORT_GAP),
    );
    const top = Math.min(
      Math.max(VIEWPORT_GAP, activation.y - 24),
      Math.max(VIEWPORT_GAP, vh - POPOVER_MAX_HEIGHT - VIEWPORT_GAP),
    );
    setPos({ top, left });
    popRef.current?.focus();
  }, [activation.x, activation.y]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) onClose();
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
      ref={popRef}
      className="folio-footnote-popover"
      role="dialog"
      aria-label="Footnote"
      tabIndex={-1}
      style={{
        top: pos?.top ?? activation.y,
        left: pos?.left ?? activation.x,
        maxWidth: POPOVER_WIDTH,
        maxHeight: POPOVER_MAX_HEIGHT,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="folio-footnote-popover__header">
        <span className="folio-footnote-popover__title">Footnote</span>
        <button
          type="button"
          className="folio-footnote-popover__close"
          aria-label="Close footnote"
          onClick={onClose}
        >
          <FolioIcons.Close size="sm" />
        </button>
      </div>
      <div
        className="folio-footnote-popover__body"
        // Sanitized by src/import/sanitize.ts before it ever reaches here.
        dangerouslySetInnerHTML={{ __html: activation.html }}
      />
    </div>
  );
}
