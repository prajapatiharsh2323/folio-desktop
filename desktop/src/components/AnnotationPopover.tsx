import { useEffect, useRef, useState } from "react";
import { FolioIcons } from "./FolioIcons";
import type { Annotation } from "../model/types";

export const SWATCHES: { color: string; label: string; css: string }[] = [
  { color: "yellow", label: "Yellow", css: "var(--folio-swatch-yellow)" },
  { color: "green", label: "Green", css: "var(--folio-swatch-green)" },
  { color: "blue", label: "Blue", css: "var(--folio-swatch-blue)" },
  { color: "pink", label: "Pink", css: "var(--folio-swatch-pink)" },
];

export interface AnnotationPopoverProps {
  annotation: Annotation;
  /** Host-relative CSS px of the activation point (fixed overlay). */
  x: number;
  y: number;
  onClose: () => void;
  onChangeColor: (color: string) => void;
  onEditNote: () => void;
  onDelete: () => void;
  onCopy: () => void;
}

/**
 * Highlight popover (R5): opened by clicking a painted highlight. Change the
 * colour in place, add/edit the note (the existing note editor dialog),
 * copy the quote, or delete with an Undo toast. Dismissed by Escape, an
 * outside press, or the close button — the reader position never changes.
 */
export function AnnotationPopover({
  annotation,
  x,
  y,
  onClose,
  onChangeColor,
  onEditNote,
  onDelete,
  onCopy,
}: AnnotationPopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  // Local colour so the active swatch reflects an in-place change immediately.
  const [color, setColor] = useState<string>(annotation.color ?? "yellow");

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
      className="folio-annotation-popover"
      role="dialog"
      aria-label="Highlight"
      style={{
        top: Math.max(8, y - 24),
        left: Math.min(Math.max(8, x - 24), Math.max(8, window.innerWidth - 300)),
      }}
    >
      {annotation.quote.trim() && (
        <blockquote className="folio-annotation-popover__quote">{annotation.quote}</blockquote>
      )}
      {annotation.note?.trim() && (
        <p className="folio-annotation-popover__note">{annotation.note}</p>
      )}
      <div
        className="folio-annotation-popover__swatches"
        role="group"
        aria-label="Highlight colour"
      >
        {SWATCHES.map((s) => (
          <button
            key={s.color}
            type="button"
            className={`folio-selection-swatch${
              color === s.color ? " folio-selection-swatch--active" : ""
            }`}
            style={{ background: s.css }}
            aria-label={`Colour ${s.label}`}
            aria-pressed={color === s.color}
            title={`Colour ${s.label}`}
            onClick={() => {
              setColor(s.color);
              onChangeColor(s.color);
            }}
          />
        ))}
      </div>
      <div className="folio-annotation-popover__actions">
        <button type="button" className="folio-annotation-popover__action" onClick={onEditNote}>
          <FolioIcons.NotePlus size="sm" />
          {annotation.note?.trim() ? "Edit note" : "Add note"}
        </button>
        <button type="button" className="folio-annotation-popover__action" onClick={onCopy}>
          <FolioIcons.Copy size="sm" />
          Copy
        </button>
        <button
          type="button"
          className="folio-annotation-popover__action folio-annotation-popover__action--danger"
          onClick={onDelete}
        >
          <FolioIcons.Trash size="sm" />
          Delete
        </button>
      </div>
    </div>
  );
}
