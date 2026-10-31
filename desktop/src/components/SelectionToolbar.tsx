import { FolioIcons } from "./FolioIcons";

const SWATCHES: { color: string; label: string; css: string }[] = [
  { color: "yellow", label: "Yellow", css: "var(--folio-swatch-yellow)" },
  { color: "green", label: "Green", css: "var(--folio-swatch-green)" },
  { color: "blue", label: "Blue", css: "var(--folio-swatch-blue)" },
  { color: "pink", label: "Pink", css: "var(--folio-swatch-pink)" },
];

export interface SelectionToolbarProps {
  rect: { top: number; left: number; bottom: number; right: number };
  onHighlight: (color: string) => void;
  onNote: () => void;
  onCopy: () => void;
}

/** Floating selection toolbar (04 §7): 4 swatches, Add note, Copy. */
export function SelectionToolbar({
  rect,
  onHighlight,
  onNote,
  onCopy,
}: SelectionToolbarProps) {
  const top = Math.max(8, rect.top - 48);
  const left = Math.min(
    window.innerWidth - 260,
    Math.max(8, (rect.left + rect.right) / 2 - 130)
  );
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
          className="folio-selection-swatch"
          style={{ background: s.css }}
          aria-label={`Highlight ${s.label}`}
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
        <FolioIcons.Search size="sm" />
      </button>
    </div>
  );
}
