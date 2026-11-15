import { FolioIcons } from "./FolioIcons";

const SWATCHES: { color: string; label: string; css: string }[] = [
  { color: "yellow", label: "Yellow", css: "var(--folio-swatch-yellow)" },
  { color: "green", label: "Green", css: "var(--folio-swatch-green)" },
  { color: "blue", label: "Blue", css: "var(--folio-swatch-blue)" },
  { color: "pink", label: "Pink", css: "var(--folio-swatch-pink)" },
];

export interface SelectionToolbarProps {
  rect: { top: number; left: number; bottom: number; right: number };
  /** Colour of an existing highlight the selection overlaps (R5): the swatch
   *  shows as active, and clicking it toggles the highlight off. */
  activeColor?: string | null;
  onHighlight: (color: string) => void;
  onNote: () => void;
  onCopy: () => void;
  /** R6: Share acts on the live selection — opens the quote card. */
  onShare: () => void;
  /** R6: copy the quote with a citation line (title/author). */
  onCopyCitation: () => void;
}

/** Floating selection toolbar (04 §7): 4 swatches, Add note, Copy,
 *  Copy with citation, Share. */
export function SelectionToolbar({
  rect,
  activeColor,
  onHighlight,
  onNote,
  onCopy,
  onShare,
  onCopyCitation,
}: SelectionToolbarProps) {
  const top = Math.max(8, rect.top - 48);
  const left = Math.min(window.innerWidth - 340, Math.max(8, (rect.left + rect.right) / 2 - 170));
  return (
    <div
      className="folio-selection-toolbar"
      role="toolbar"
      aria-label="Selection actions"
      style={{ top, left }}
    >
      {SWATCHES.map((s) => (
        <button
          key={s.color}
          type="button"
          className={`folio-selection-swatch${
            activeColor === s.color ? " folio-selection-swatch--active" : ""
          }`}
          style={{ background: s.css }}
          aria-label={`Highlight ${s.label}`}
          aria-pressed={activeColor === s.color}
          title={`Highlight ${s.label}`}
          onClick={() => onHighlight(s.color)}
        />
      ))}
      <button
        type="button"
        className="folio-selection-btn"
        aria-label="Add note"
        title="Add note"
        onClick={onNote}
      >
        <FolioIcons.NotePlus />
      </button>
      <button
        type="button"
        className="folio-selection-btn"
        aria-label="Copy"
        title="Copy"
        onClick={onCopy}
      >
        <FolioIcons.Copy size="sm" />
      </button>
      <button
        type="button"
        className="folio-selection-btn"
        aria-label="Copy with citation"
        title="Copy with citation"
        onClick={onCopyCitation}
      >
        <FolioIcons.Book size="sm" />
      </button>
      <button
        type="button"
        className="folio-selection-btn"
        aria-label="Share as image"
        title="Share as image"
        onClick={onShare}
      >
        <FolioIcons.Share size="sm" />
      </button>
    </div>
  );
}
