import { useEffect, useRef } from "react";
import { FolioIcons } from "./FolioIcons";
import { ReaderDock } from "./ReaderDock";

export interface ReaderChromeProps {
  visible: boolean;
  /** Context-appropriate back label — the reader can return to any route. */
  backLabel: string;
  title: string;
  chapterTitle: string;
  /** 0..100 total progression */
  percent: number;
  timeLeft: string | null;
  /** value while dragging the scrubber, otherwise null */
  scrubValue: number | null;
  /** an absolute navigation is resolving */
  seeking: boolean;
  /** current position already has a bookmark */
  bookmarked: boolean;
  /** Controlled More-menu state (ReaderScreen owns Escape/auto-hide). */
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
  onBack: () => void;
  onAppearance: () => void;
  onContents: () => void;
  onSearch?: () => void;
  onBookmark: () => void;
  onShareQuote?: () => void;
  shareEnabled?: boolean;
  onToggleChrome: () => void;
  /** Focus / pointer holds: the chrome must not hide under the user. */
  onHold: (reason: "focus" | "pointer", active: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
  onScrubStart: () => void;
  onScrubChange: (percent: number) => void;
  onScrubEnd: (percent: number) => void;
  /** Optional premium feature callbacks */
  onFocusMode?: () => void;
  isFocusMode?: boolean;
  onSessionInfo?: () => void;
  onShortcutsGuide?: () => void;
}

/**
 * Reader overlay chrome:
 * Top toolbar (Back, Title, Contents, Search, Bookmark, Appearance, More)
 * and bottom navigation dock (Previous, Chapter, Percent, Time left, Next, Slider).
 * All controls are sized to min 40–44px for comfortable, accessible interaction.
 */
export function ReaderChrome({
  visible,
  backLabel,
  title,
  chapterTitle,
  percent,
  timeLeft,
  scrubValue,
  seeking,
  bookmarked,
  menuOpen,
  onMenuChange,
  onBack,
  onAppearance,
  onContents,
  onSearch,
  onBookmark,
  onShareQuote,
  shareEnabled = false,
  onToggleChrome,
  onHold,
  onPrevious,
  onNext,
  onScrubStart,
  onScrubChange,
  onScrubEnd,
  onFocusMode,
  isFocusMode = false,
  onSessionInfo,
  onShortcutsGuide,
}: ReaderChromeProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onMenuChange(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [menuOpen, onMenuChange]);

  // Hidden chrome leaves the tab order and accessibility tree
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (visible && !isFocusMode) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [visible, isFocusMode]);

  const closeMenu = () => onMenuChange(false);
  const progressFill = Math.round(Math.min(100, Math.max(0, percent)));

  return (
    <>
      <div
        ref={rootRef}
        className={`folio-reader-chrome${visible && !isFocusMode ? " is-visible" : ""}`}
        aria-hidden={!visible || isFocusMode}
        onPointerEnter={() => onHold("pointer", true)}
        onPointerLeave={() => onHold("pointer", false)}
        onFocusCapture={() => onHold("focus", true)}
        onBlurCapture={(e) => {
          const next = e.relatedTarget as Node | null;
          if (!next || !e.currentTarget.contains(next)) onHold("focus", false);
        }}
      >
        <header className="folio-reader-top" role="toolbar" aria-label="Reader controls">
          <div className="folio-reader-top__group">
            <button
              type="button"
              className="folio-reader-icon"
              onClick={onBack}
              aria-label={backLabel}
              title={backLabel}
            >
              <FolioIcons.Back />
            </button>
          </div>

          <div className="folio-reader-top__center">
            <div className="folio-reader-top__title" title={title}>
              {title}
            </div>
            <div className="folio-reader-top__chapter" title={chapterTitle}>
              {chapterTitle}
            </div>
          </div>

          <div className="folio-reader-top__group folio-reader-top__group--end">
            <button
              type="button"
              className="folio-reader-icon"
              onClick={onContents}
              aria-label="Contents"
              aria-keyshortcuts="T"
              title="Contents (T)"
            >
              <FolioIcons.Toc />
            </button>
            <button
              type="button"
              className="folio-reader-icon"
              aria-label="Search in book"
              aria-keyshortcuts="Control+F"
              title="Search in book (Ctrl+F)"
              disabled={!onSearch}
              onClick={() => onSearch?.()}
            >
              <FolioIcons.Search />
            </button>
            <button
              type="button"
              className={`folio-reader-icon${bookmarked ? " is-active" : ""}`}
              aria-label={bookmarked ? "Remove bookmark" : "Add bookmark"}
              aria-pressed={bookmarked}
              aria-keyshortcuts="Control+B"
              title={bookmarked ? "Remove bookmark (Ctrl+B)" : "Add bookmark (Ctrl+B)"}
              onClick={onBookmark}
            >
              <FolioIcons.Bookmark />
            </button>
            <button
              type="button"
              className="folio-reader-icon"
              aria-label="Appearance"
              title="Appearance"
              onClick={onAppearance}
            >
              <FolioIcons.Aa />
            </button>

            <div className="folio-reader-menu" ref={menuRef}>
              <button
                type="button"
                id="folio-reader-more"
                className="folio-reader-icon"
                aria-label="More"
                title="More"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => onMenuChange(!menuOpen)}
              >
                <FolioIcons.More />
              </button>
              {menuOpen && (
                <div className="folio-reader-menu__popover" role="menu">
                  {onFocusMode && (
                    <button
                      type="button"
                      role="menuitem"
                      className="folio-reader-menu__item"
                      onClick={() => {
                        closeMenu();
                        onFocusMode();
                      }}
                    >
                      <FolioIcons.Focus size="sm" />
                      <span className="folio-reader-menu__label">Focus mode</span>
                      <kbd className="folio-reader-menu__hint" aria-hidden="true">
                        F
                      </kbd>
                    </button>
                  )}

                  {onSessionInfo && (
                    <button
                      type="button"
                      role="menuitem"
                      className="folio-reader-menu__item"
                      onClick={() => {
                        closeMenu();
                        onSessionInfo();
                      }}
                    >
                      <FolioIcons.Clock size="sm" />
                      <span className="folio-reader-menu__label">Reading session</span>
                    </button>
                  )}

                  {onShortcutsGuide && (
                    <button
                      type="button"
                      role="menuitem"
                      className="folio-reader-menu__item"
                      onClick={() => {
                        closeMenu();
                        onShortcutsGuide();
                      }}
                    >
                      <FolioIcons.Keyboard size="sm" />
                      <span className="folio-reader-menu__label">Keyboard shortcuts</span>
                      <kbd className="folio-reader-menu__hint" aria-hidden="true">
                        ?
                      </kbd>
                    </button>
                  )}

                  {onShareQuote && (
                    <button
                      type="button"
                      role="menuitem"
                      className="folio-reader-menu__item"
                      disabled={!shareEnabled}
                      title={shareEnabled ? "Share as image" : "Select text first"}
                      onClick={() => {
                        closeMenu();
                        onShareQuote();
                      }}
                    >
                      <FolioIcons.Info size="sm" />
                      <span className="folio-reader-menu__label">Share as image</span>
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    className="folio-reader-menu__item"
                    onClick={() => {
                      closeMenu();
                      onToggleChrome();
                    }}
                  >
                    <FolioIcons.Toc size="sm" />
                    <span className="folio-reader-menu__label">Hide controls</span>
                    <kbd className="folio-reader-menu__hint" aria-hidden="true">
                      m
                    </kbd>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <ReaderDock
          chapterTitle={chapterTitle}
          percent={percent}
          timeLeft={timeLeft}
          scrubValue={scrubValue}
          seeking={seeking}
          onPrevious={onPrevious}
          onNext={onNext}
          onScrubStart={onScrubStart}
          onScrubChange={onScrubChange}
          onScrubEnd={onScrubEnd}
        />
      </div>

      {/* Focus Mode Exit Pill */}
      {isFocusMode && onFocusMode && (
        <div className="folio-reader-focus-exit">
          <button
            type="button"
            className="folio-reader-focus-exit__btn"
            onClick={onFocusMode}
            aria-label="Exit Focus Mode (Esc or F)"
            title="Exit Focus Mode (Esc)"
          >
            <FolioIcons.Focus size="sm" />
            <span>Exit Focus Mode</span>
            <kbd className="folio-reader-focus-exit__kbd">Esc</kbd>
          </button>
        </div>
      )}

      {/* Hairline progress indicator */}
      <div className="folio-reader-hairline" aria-hidden="true">
        <span className="folio-reader-hairline__fill" style={{ width: `${progressFill}%` }} />
      </div>
    </>
  );
}
