import { useCallback, useRef } from "react";
import { FolioIcons } from "./FolioIcons";

export interface ReaderDockProps {
  chapterTitle: string;
  /** 0..100 total progression (preview value while scrubbing) */
  percent: number;
  timeLeft: string | null;
  /** value while dragging/scrubbing, otherwise null */
  scrubValue: number | null;
  /** an absolute jump is resolving */
  seeking: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onScrubStart: () => void;
  onScrubChange: (percent: number) => void;
  onScrubEnd: (percent: number) => void;
}

const SCRUB_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * Bottom navigation dock (04 §5): Previous/Next on either side of the reading
 * position, with the progress slider underneath. The slider previews while
 * dragging and commits exactly once on release (pointer, keyboard or blur).
 */
export function ReaderDock({
  chapterTitle,
  percent,
  timeLeft,
  scrubValue,
  seeking,
  onPrevious,
  onNext,
  onScrubStart,
  onScrubChange,
  onScrubEnd,
}: ReaderDockProps) {
  const value = scrubValue ?? percent;
  const scrubbing = useRef(false);
  /** Last value the input reported — a controlled re-render can reset the DOM
   *  value before pointerup, so commit from here, not from the element. */
  const latestValue = useRef(value);

  const begin = useCallback(() => {
    if (scrubbing.current) return;
    scrubbing.current = true;
    onScrubStart();
  }, [onScrubStart]);

  /** Release the scrub once — a keyup, blur and pointerup must not triple-jump. */
  const commit = useCallback(
    (next: number) => {
      if (!scrubbing.current) return;
      scrubbing.current = false;
      onScrubEnd(next);
    },
    [onScrubEnd]
  );

  return (
    <div
      className="folio-reader-dock"
      role="group"
      aria-label="Reading progress and page navigation"
    >
      <div className="folio-reader-dock__row">
        <button
          type="button"
          className="folio-reader-dock__turn"
          aria-label="Previous page"
          title="Previous page (PageUp)"
          onClick={onPrevious}
        >
          <FolioIcons.ChevronLeft />
        </button>

        <div className="folio-reader-dock__meta">
          <span className="folio-reader-dock__chapter" title={chapterTitle}>
            {chapterTitle}
          </span>
          <span className="folio-reader-dock__stats">
            <span className="folio-reader-dock__percent">{Math.round(value)}%</span>
            {timeLeft && <span className="folio-reader-dock__time">{timeLeft}</span>}
            {seeking && (
              <span className="folio-reader-dock__seeking" role="status">
                Jumping…
              </span>
            )}
          </span>
        </div>

        <button
          type="button"
          className="folio-reader-dock__turn"
          aria-label="Next page"
          title="Next page (PageDown)"
          onClick={onNext}
        >
          <FolioIcons.ChevronRight />
        </button>
      </div>

      <input
        type="range"
        className="folio-reader-dock__slider"
        min={0}
        max={100}
        step={1}
        value={Math.min(100, Math.max(0, value))}
        aria-label="Reading progress"
        aria-valuetext={`${Math.round(value)} percent`}
        aria-busy={seeking}
        onPointerDown={(e) => {
          latestValue.current = Number(e.currentTarget.value);
          begin();
        }}
        onChange={(e) => {
          const next = Number(e.currentTarget.value);
          latestValue.current = next;
          begin();
          onScrubChange(next);
        }}
        onPointerUp={() => commit(latestValue.current)}
        onPointerCancel={() => commit(latestValue.current)}
        onKeyDown={(e) => {
          if (SCRUB_KEYS.has(e.key)) begin();
        }}
        onKeyUp={(e) => {
          if (SCRUB_KEYS.has(e.key)) commit(latestValue.current);
        }}
        onBlur={() => commit(latestValue.current)}
      />
    </div>
  );
}
