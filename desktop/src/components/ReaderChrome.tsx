import { useEffect, useRef, useState } from "react";
import { FolioIcons } from "./FolioIcons";

export interface ReaderChromeProps {
  visible: boolean;
  title: string;
  chapterTitle: string;
  /** 0..100 total progression */
  percent: number;
  timeLeft: string | null;
  /** value while dragging the scrubber, otherwise null */
  scrubValue: number | null;
  onBack: () => void;
  onAppearance: () => void;
  onToc: () => void;
  onSearch?: () => void;
  onBookmark: () => void;
  onShareQuote?: () => void;
  shareEnabled?: boolean;
  onScrubStart: () => void;
  onScrubChange: (percent: number) => void;
  onScrubEnd: (percent: number) => void;
}

/** Reader overlay chrome (03 §5.3, 04 §5): themed top bar + bottom pillar.
 * The canvas theme drives the surface, not the app palette. */
export function ReaderChrome({
  visible,
  title,
  chapterTitle,
  percent,
  timeLeft,
  scrubValue,
  onBack,
  onAppearance,
  onToc,
  onSearch,
  onBookmark,
  onShareQuote,
  shareEnabled = false,
  onScrubStart,
  onScrubChange,
  onScrubEnd,
}: ReaderChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const value = scrubValue ?? percent;

  useEffect(() => {
    if (!visible) setMenuOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [menuOpen]);

  return (
    <div className={`folio-reader-chrome${visible ? " is-visible" : ""}`} aria-hidden={!visible}>
      <header className="folio-reader-top" role="toolbar" aria-label="Reader controls">
        <button type="button" className="folio-reader-icon" onClick={onBack} aria-label="Back to library">
          <FolioIcons.Back />
        </button>
        <div className="folio-reader-top__title" title={title}>
          {title}
        </div>
        <button
          type="button"
          className="folio-reader-icon"
          onClick={onAppearance}
          aria-label="Appearance"
          title="Appearance"
        >
          <FolioIcons.Aa />
        </button>
        <button
          type="button"
          className="folio-reader-icon"
          aria-label="Search in book"
          title="Search in book"
          disabled={!onSearch}
          onClick={() => onSearch?.()}
        >
          <FolioIcons.Search />
        </button>
        <div className="folio-reader-menu" ref={menuRef}>
          <button
            type="button"
            className="folio-reader-icon"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <FolioIcons.More />
          </button>
          {menuOpen && (
            <div className="folio-reader-menu__popover" role="menu">
              <button
                type="button"
                role="menuitem"
                className="folio-reader-menu__item"
                onClick={() => {
                  setMenuOpen(false);
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
                disabled
                title="Bookmarks arrive in Phase 5"
                onClick={() => {
                  setMenuOpen(false);
                  onBookmark();
                }}
              >
                <FolioIcons.Bookmark size="sm" />
                Add bookmark — Phase 5
              </button>
              {onShareQuote && (
                <button
                  type="button"
                  role="menuitem"
                  className="folio-reader-menu__item"
                  disabled={!shareEnabled}
                  title={shareEnabled ? "Share as image" : "Select text first"}
                  onClick={() => {
                    setMenuOpen(false);
                    onShareQuote();
                  }}
                >
                  <FolioIcons.Info size="sm" />
                  Share as image
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="folio-reader-pillar">
        <div className="folio-reader-pillar__meta">
          <span className="folio-reader-pillar__chapter" title={chapterTitle}>
            {chapterTitle}
          </span>
          <span className="folio-reader-pillar__percent">{Math.round(value)}%</span>
          {timeLeft && <span className="folio-reader-pillar__time">{timeLeft}</span>}
        </div>
        <input
          type="range"
          className="folio-reader-scrubber"
          min={0}
          max={100}
          step={0.1}
          value={Math.min(100, Math.max(0, value))}
          aria-label="Reading progress"
          aria-valuetext={`${Math.round(value)} percent`}
          onPointerDown={onScrubStart}
          onChange={(e) => onScrubChange(Number(e.currentTarget.value))}
          onPointerUp={(e) => onScrubEnd(Number(e.currentTarget.value))}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
              onScrubStart();
            }
          }}
          onKeyUp={(e) => {
            if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
              onScrubEnd(Number(e.currentTarget.value));
            }
          }}
          onBlur={(e) => {
            if (scrubValue !== null) onScrubEnd(Number(e.currentTarget.value));
          }}
        />
      </div>
    </div>
  );
}
