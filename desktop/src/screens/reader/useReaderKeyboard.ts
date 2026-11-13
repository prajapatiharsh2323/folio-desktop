// The reader keyboard matrix (07 §1): page turns, jumps, panels, bookmark,
// chrome toggle, Ctrl+F, focus mode, shortcuts guide and the Escape ladder.
// Everything is injected so the hook stays a pure input→intent mapping; all
// navigation still flows through the coordinator via `reportNavigation`.
import { useEffect } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { ReaderDoc } from "../../store/readerStore";
import type { ReaderEngine } from "../../reader/ReaderEngine";
import type { ChromeStateMachine } from "../../reader/chrome";
import type { ReaderNavigationCoordinator, NavigationOutcome } from "../../reader/navigation";
import type { BookmarkResult } from "./useAnnotations";
import type { ReaderPanel } from "./useReaderChrome";
import { isTextEntryTarget, isActivatableTarget } from "./keyGuards";

interface UseReaderKeyboardOptions {
  doc: ReaderDoc | null;
  engineRef: RefObject<ReaderEngine | null>;
  navRef: RefObject<ReaderNavigationCoordinator | null>;
  chromeRef: RefObject<ChromeStateMachine | null>;
  bookmarkToggleRef: MutableRefObject<() => Promise<BookmarkResult>>;

  // Chrome state (from useReaderChrome)
  isFocusMode: boolean;
  toggleFocusMode: () => void;
  exitFocusMode: () => void;
  panel: ReaderPanel | null;
  closePanel: () => void;
  togglePanel: (panel: ReaderPanel) => void;
  menuOpenRef: MutableRefObject<boolean>;
  setMenu: (open: boolean) => void;

  // In-book search (from useInBookSearch)
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;

  // Interactions owned by the screen
  clearSelection: () => void;
  ctxMenu: { x: number; y: number } | null;
  clearCtxMenu: () => void;
  noteEditorOpen: boolean;
  closeNoteEditor: () => void;
  quoteCardOpen: boolean;
  setQuoteCardOpen: Dispatch<SetStateAction<boolean>>;
  sessionInfoOpen: boolean;
  setSessionInfoOpen: Dispatch<SetStateAction<boolean>>;
  shortcutsGuideOpen: boolean;
  setShortcutsGuideOpen: Dispatch<SetStateAction<boolean>>;

  reportNavigation: (pending: Promise<NavigationOutcome>, message: string) => void;
  showNavNotice: (message: string) => void;
  announceBookmark: (result: BookmarkResult) => void;
  setChromeVisible: Dispatch<SetStateAction<boolean>>;
}

export function useReaderKeyboard({
  doc,
  engineRef,
  navRef,
  chromeRef,
  bookmarkToggleRef,
  isFocusMode,
  toggleFocusMode,
  exitFocusMode,
  panel,
  closePanel,
  togglePanel,
  menuOpenRef,
  setMenu,
  searchOpen,
  setSearchOpen,
  clearSelection,
  ctxMenu,
  clearCtxMenu,
  noteEditorOpen,
  closeNoteEditor,
  quoteCardOpen,
  setQuoteCardOpen,
  sessionInfoOpen,
  setSessionInfoOpen,
  shortcutsGuideOpen,
  setShortcutsGuideOpen,
  reportNavigation,
  showNavNotice,
  announceBookmark,
  setChromeVisible,
}: UseReaderKeyboardOptions): void {
  useEffect(() => {
    if (!doc) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isTextEntryTarget(event.target)) return;
      if (event.key === " " && isActivatableTarget(event.target)) return;
      const engine = engineRef.current;
      if (!engine) return;

      const turn = (direction: "next" | "previous") => {
        const nav = navRef.current;
        if (!nav) return;
        reportNavigation(
          nav[direction]("keyboard"),
          direction === "next" ? "Couldn't turn the page forward." : "Couldn't turn the page back.",
        );
      };
      const jump = (percent: number) => {
        const nav = navRef.current;
        if (!nav) return;
        reportNavigation(nav.goToPercent(percent, "keyboard"), "Couldn't jump to that position.");
      };

      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
        case "ArrowDown":
          event.preventDefault();
          turn("next");
          break;
        case "ArrowLeft":
        case "PageUp":
        case "ArrowUp":
          event.preventDefault();
          turn("previous");
          break;
        case " ":
          event.preventDefault();
          if (event.shiftKey) turn("previous");
          else turn("next");
          break;
        case "Home":
          event.preventDefault();
          jump(0);
          break;
        case "End":
          event.preventDefault();
          jump(100);
          break;
        case "MediaTrackNext":
          event.preventDefault();
          turn("next");
          break;
        case "MediaTrackPrevious":
          event.preventDefault();
          turn("previous");
          break;
        case "t":
        case "T":
          event.preventDefault();
          togglePanel("toc");
          break;
        case "b":
        case "B":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            void bookmarkToggleRef.current().then(announceBookmark);
          }
          break;
        case "m":
        case "M":
          event.preventDefault();
          chromeRef.current?.toggle();
          setChromeVisible(chromeRef.current?.visible ?? false);
          break;
        case "f":
        case "F":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            setSearchOpen((open) => !open);
            chromeRef.current?.onActivity();
            setChromeVisible(true);
          } else {
            // Unmodified 'f' toggles focus mode
            event.preventDefault();
            toggleFocusMode();
          }
          break;
        case "?":
          event.preventDefault();
          setShortcutsGuideOpen((open) => !open);
          break;
        case "Escape":
          // Close topmost interaction:
          // Menu → Shortcuts → Session info → Note editor → Quote card → Ctx menu → Panel → Search → Focus mode → Selection
          if (menuOpenRef.current) {
            setMenu(false);
            document.getElementById("folio-reader-more")?.focus();
          } else if (shortcutsGuideOpen) {
            setShortcutsGuideOpen(false);
          } else if (sessionInfoOpen) {
            setSessionInfoOpen(false);
          } else if (noteEditorOpen) {
            closeNoteEditor();
          } else if (quoteCardOpen) {
            setQuoteCardOpen(false);
          } else if (ctxMenu) {
            clearCtxMenu();
          } else if (panel) {
            closePanel();
          } else if (searchOpen) {
            setSearchOpen(false);
          } else if (isFocusMode) {
            exitFocusMode();
            showNavNotice("Exited focus mode.");
          } else {
            clearSelection();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    doc,
    panel,
    searchOpen,
    ctxMenu,
    isFocusMode,
    shortcutsGuideOpen,
    sessionInfoOpen,
    noteEditorOpen,
    quoteCardOpen,
    engineRef,
    navRef,
    chromeRef,
    bookmarkToggleRef,
    menuOpenRef,
    toggleFocusMode,
    exitFocusMode,
    closePanel,
    togglePanel,
    setMenu,
    setSearchOpen,
    clearSelection,
    clearCtxMenu,
    closeNoteEditor,
    setQuoteCardOpen,
    setSessionInfoOpen,
    setShortcutsGuideOpen,
    reportNavigation,
    showNavNotice,
    announceBookmark,
    setChromeVisible,
  ]);
}
