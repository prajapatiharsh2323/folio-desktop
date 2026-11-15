// Bottom navigation dock (04 §5, R11): Previous/Next on either side of the
// reading position, with the progress slider underneath. The slider scrubs in
// 0.1% steps (keyboard nudges by whole points so it stays usable), previews
// with a chapter tooltip while dragging, and commits exactly once on release
// (pointer, keyboard or blur). Chapter start marks draw ticks on the track;
// a finished book replaces the percent label with "Finished".
import { useCallback, useRef } from "react";
import { FolioIcons } from "./FolioIcons";

export interface ReaderDockProps {
  chapterTitle: string;
  /** 0..100 total progression (preview value while scrubbing) */
  percent: number;
  timeLeft: string | null;
  /** R11: "≈ N min left in chapter" for the current chapter, when known. */
  chapterTimeLeft: string | null;
  /** R11: start percent (0..100) of each chapter, in reading order. */
  chapterMarks: { percent: number; title: string }[];
  /** R11: the reading position reached the end of the book. */
  finished: boolean;
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

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/** Title of the chapter a position falls in ("last mark ≤ percent"). */
function chapterAt(marks: { percent: number; title: string }[], percent: number): string | null {
  let found: string | null = null;
  for (const mark of marks) {
    if (mark.percent <= percent + 0.05) found = mark.title;
    else break;
  }
  return found;
}

export function ReaderDock({
  chapterTitle,
  percent,
  timeLeft,
  chapterTimeLeft,
  chapterMarks,
  finished,
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
    [onScrubEnd],
  );

  /** Keyboard scrub moves in whole points (R11): the 0.1% pointer step would
   *  need a thousand presses to cross the book. */
  const nudge = useCallback(
    (next: number) => {
      latestValue.current = clamp(next);
      begin();
      onScrubChange(latestValue.current);
    },
    [begin, onScrubChange],
  );

  const onSliderKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!SCRUB_KEYS.has(e.key)) return;
      e.preventDefault();
      const base = latestValue.current;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowUp":
          nudge(base + 1);
          break;
        case "ArrowLeft":
        case "ArrowDown":
          nudge(base - 1);
          break;
        case "PageUp":
          nudge(base + 10);
          break;
        case "PageDown":
          nudge(base - 10);
          break;
        case "Home":
          nudge(0);
          break;
        case "End":
          nudge(100);
          break;
      }
    },
    [nudge],
  );

  /** Whole-point floor label (R11): never claims 100% before the end. */
  const label = finished ? "Finished" : `${Math.floor(clamp(value))}%`;
  const tooltipChapter = scrubValue === null ? null : chapterAt(chapterMarks, value);

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
            <span
              className={`folio-reader-dock__percent${finished ? " folio-reader-dock__percent--finished" : ""}`}
            >
              {label}
            </span>
            {!finished && timeLeft && <span className="folio-reader-dock__time">{timeLeft}</span>}
            {!finished && chapterTimeLeft && (
              <span className="folio-reader-dock__chaptertime">{chapterTimeLeft}</span>
            )}
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

      <div className="folio-reader-dock__track">
        {chapterMarks.map((mark, i) => (
          <span
            key={`${mark.percent}-${i}`}
            className="folio-reader-dock__tick"
            style={{ left: `${Math.min(100, Math.max(0, mark.percent))}%` }}
            title={mark.title}
          />
        ))}
        {tooltipChapter !== null && (
          <div
            className="folio-reader-dock__tooltip"
            role="tooltip"
            style={{ left: `${Math.min(100, Math.max(0, value))}%` }}
          >
            {Math.floor(clamp(value))}% · {tooltipChapter}
          </div>
        )}
        <input
          type="range"
          className="folio-reader-dock__slider"
          min={0}
          max={100}
          step={0.1}
          value={Math.min(100, Math.max(0, value))}
          aria-label="Reading progress"
          aria-valuetext={
            finished
              ? "Finished"
              : `${Math.floor(clamp(value))} percent${tooltipChapter ? `, ${tooltipChapter}` : ""}`
          }
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
          onKeyDown={onSliderKeyDown}
          onKeyUp={(e) => {
            if (SCRUB_KEYS.has(e.key)) commit(latestValue.current);
          }}
          onBlur={() => commit(latestValue.current)}
        />
      </div>
    </div>
  );
}
