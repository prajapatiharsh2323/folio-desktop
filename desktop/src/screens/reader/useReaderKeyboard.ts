// The reader keyboard matrix (07 §1, R13): page turns, jumps, chapters,
// panels, bookmark, chrome toggle, Ctrl+F, text size, distraction-free mode,
// shortcuts guide and the Escape ladder. Everything is injected so the hook
// stays a pure input→intent mapping; all navigation still flows through the
// coordinator via `reportNavigation`.
//
// Modal Escape never reaches this hook: FolioDialog/FolioPanel close
// themselves through the modal stack (capture-phase, stopPropagation), so
// the ladder below only owns non-modal surfaces (menu, context menu, panel,
// distraction-free, selection).
import { useEffect } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { ReaderDoc } from "../../store/readerStore";
import type { ReaderEngine } from "../../reader/ReaderEngine";
import type { ChromeStateMachine } from "../../reader/chrome";
import type { ReaderNavigationCoordinator, NavigationOutcome } from "../../reader/navigation";
import type { BookmarkResult } from "./useAnnotations";
import type { ReaderPanel } from "./useReaderChrome";
import { isTextEntryTarget, isActivatableTarget } from "./keyGuards";

/** Text-size intents driven by Ctrl+=/−/0 (R13). */
export type TextSizeAction = "larger" | "smaller" | "reset";

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
  /** Ctrl+F: toggle the search panel through the chrome's single panel slot. */
  toggleSearch: () => void;
  /** Next/Prev match (F3 / Shift+F3); no-ops when nothing to step through. */
  searchNext: () => void;
  searchPrev: () => void;
  /** Return through the position history (Alt+Left, R4). */
  goBack: () => void;
  /** Re-advance through positions abandoned by Back (Alt+Right, R4/X1). */
  goForward: () => void;

  // Reading prefs and chapters (R13)
  /** Ctrl+= / Ctrl+− / Ctrl+0: larger / smaller / reset this book's text. */
  onTextSize: (action: TextSizeAction) => void;
  /** `[` / `]`: previous / next chapter in the TOC order. */
  stepChapter: (direction: "next" | "previous") => void;

  // Interactions owned by the screen
  clearSelection: () => void;
  ctxMenu: { x: number; y: number } | null;
  clearCtxMenu: () => void;
  /** `?`: toggle the shortcuts guide (the dialog closes itself on Escape). */
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
  toggleSearch,
  searchNext,
  searchPrev,
  goBack,
  goForward,
  onTextSize,
  stepChapter,
  clearSelection,
  ctxMenu,
  clearCtxMenu,
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

      // Bare letters must not fire when the user is running a browser or app
      // combo through them (R13): no Ctrl/Meta/Alt. Shift is allowed — `?`
      // IS Shift+/, and `T` covers Caps/Shift typing.
      const bare = !event.ctrlKey && !event.metaKey && !event.altKey;
      const menu = event.ctrlKey || event.metaKey;

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
          if (event.key === "ArrowRight" && event.altKey) {
            // Alt+Right re-advances through positions abandoned by Back (X1).
            goForward();
          } else {
            turn("next");
          }
          break;
        case "ArrowLeft":
        case "PageUp":
        case "ArrowUp":
          event.preventDefault();
          if (event.key === "ArrowLeft" && event.altKey) {
            // Alt+Left returns through the position history (07 §1, R4).
            goBack();
          } else {
            turn("previous");
          }
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
        case "[":
          event.preventDefault();
          stepChapter("previous");
          break;
        case "]":
          event.preventDefault();
          stepChapter("next");
          break;
        case "=":
        case "+":
          if (menu) {
            // Browser zoom lives on Ctrl+= too; the reader owns it here.
            event.preventDefault();
            onTextSize("larger");
          }
          break;
        case "-":
        case "_":
          if (menu) {
            event.preventDefault();
            onTextSize("smaller");
          }
          break;
        case "0":
          if (menu) {
            event.preventDefault();
            onTextSize("reset");
          }
          break;
        case "t":
        case "T":
          if (!bare) break;
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
          if (!bare) break;
          event.preventDefault();
          chromeRef.current?.toggle();
          setChromeVisible(chromeRef.current?.visible ?? false);
          break;
        case "f":
        case "F":
          if (menu) {
            event.preventDefault();
            toggleSearch();
          } else if (bare) {
            // Unmodified 'f' toggles Distraction-free reading (R13 naming).
            event.preventDefault();
            toggleFocusMode();
          }
          break;
        case "F3":
          // Step through in-book matches; Shift+F3 goes back (07 §1).
          event.preventDefault();
          if (event.shiftKey) searchPrev();
          else searchNext();
          break;
        case "?":
          if (!bare) break;
          event.preventDefault();
          setShortcutsGuideOpen((open) => !open);
          break;
        case "Escape":
          // Close topmost non-modal interaction (modals close themselves via
          // the modal stack): Menu → Ctx menu → Panel (incl. Search) →
          // Distraction-free → Selection
          if (menuOpenRef.current) {
            setMenu(false);
            document.getElementById("folio-reader-more")?.focus();
          } else if (ctxMenu) {
            clearCtxMenu();
          } else if (panel) {
            closePanel();
          } else if (isFocusMode) {
            exitFocusMode();
            showNavNotice("Exited distraction-free mode.");
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
    toggleSearch,
    ctxMenu,
    isFocusMode,
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
    onTextSize,
    stepChapter,
    setShortcutsGuideOpen,
    searchNext,
    searchPrev,
    goBack,
    goForward,
    clearSelection,
    clearCtxMenu,
    reportNavigation,
    showNavNotice,
    announceBookmark,
    setChromeVisible,
  ]);
}
