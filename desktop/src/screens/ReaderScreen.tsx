import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppearancePanel } from "../components/AppearancePanel";
import { ReaderChrome } from "../components/ReaderChrome";
import { ReaderContextMenu } from "../components/ReaderContextMenu";
import { ReaderSplash, type SplashPhase } from "../components/ReaderSplash";
import { TocPanel } from "../components/TocPanel";
import { InBookSearchPanel } from "../components/InBookSearchPanel";
import { ReadingSessionDialog } from "../components/ReadingSessionDialog";
import { KeyboardShortcutsDialog } from "../components/KeyboardShortcutsDialog";
import { SelectionToolbar } from "../components/SelectionToolbar";
import { QuoteCard } from "../components/QuoteCard";
import { FolioDialog } from "../components/FolioDialog";
import { FolioButton } from "../components/FolioButton";
import { tintIndexFromHash } from "../import/cover";
import type { TextSelectionInfo } from "../reader/ReaderEngine";
import { useReaderStore } from "../store/readerStore";
import { useRouteStore } from "../store/routeStore";
import { getLibraryManager } from "../store/libraryUi";
import { pushToast } from "../shell/toasts";
import { describeError, handleError } from "../lib/errorLog";
import { DEFAULT_READING_PREFS } from "../model/defaults";
import type { ReadingPrefs, Annotation } from "../model/types";
import { nowIso } from "../model/ids";
import type { ReaderEngine } from "../reader/ReaderEngine";
import { ChromeStateMachine, type ChromeHold } from "../reader/chrome";
import type {
  NavigationOrigin,
  NavigationOutcome,
  ReaderNavigationCoordinator,
} from "../reader/navigation";
import { flushAndClose } from "../lib/lifecycle";
import { formatTimeLeft } from "../reader/pace";
import { hrefOf, sameLocation } from "../reader/locatorCodec";
import { resolveReaderTheme, scrimAlpha } from "../reader/readerThemes";
import { isTauri, KeepAwakeController } from "../reader/keepAwake";
import { useInBookSearch } from "./reader/useInBookSearch";
import { useReaderChrome } from "./reader/useReaderChrome";
import { useAnnotations, type BookmarkResult } from "./reader/useAnnotations";
import { useReaderKeyboard } from "./reader/useReaderKeyboard";
import { useReaderEngine } from "./reader/useReaderEngine";

const CLOSE_FLUSH_CAP_MS = 1500;

/** Resolve/reject within `ms`; used to cap the close-time progress flush. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function hrefMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  // Stored locations carry progression/anchor query parameters; compare hrefs.
  const x = hrefOf(a) ?? a;
  const y = hrefOf(b) ?? b;
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

/** The reader returns to whatever opened it, so the back label must follow. */
function backLabelFor(route: string | undefined): string {
  switch (route) {
    case "collections":
      return "Back to Collections";
    case "notes":
      return "Back to Notes";
    case "settings":
      return "Back to Settings";
    default:
      return "Back to Library";
  }
}

/** Reader route: splash → Readium canvas → themed chrome + workspace panels. */
export function ReaderScreen() {
  const request = useRouteStore((s) => s.readerRequest);
  const readerOrigin = useRouteStore((s) => s.readerOrigin);
  const closeReader = useRouteStore((s) => s.closeReader);
  const status = useReaderStore((s) => s.status);
  const loadError = useReaderStore((s) => s.error);
  const doc = useReaderStore((s) => s.doc);
  const load = useReaderStore((s) => s.load);
  const closeDoc = useReaderStore((s) => s.close);
  const savePrefs = useReaderStore((s) => s.savePrefs);
  const resetPrefs = useReaderStore((s) => s.resetPrefs);
  const persistProgress = useReaderStore((s) => s.persistProgress);

  const canvasRef = useRef<HTMLDivElement>(null);
  // Created here so the chrome, annotations and engine hooks can share them
  // without circular hook arguments.
  const engineRef = useRef<ReaderEngine | null>(null);
  const navRef = useRef<ReaderNavigationCoordinator | null>(null);
  const chromeRef = useRef<ChromeStateMachine | null>(null);
  if (!chromeRef.current) chromeRef.current = new ChromeStateMachine();
  const keepAwakeRef = useRef<KeepAwakeController | null>(null);
  const prefsRef = useRef<ReadingPrefs>(DEFAULT_READING_PREFS);
  const savedPrefsRef = useRef("");
  const disposedRef = useRef(false);
  const previousPercentRef = useRef<number | null>(null);
  /** A live selection owns the pointer — edge clicks must not turn the page. */
  const selectionRef = useRef<TextSelectionInfo | null>(null);
  const sessionStartTsRef = useRef(Date.now());

  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_READING_PREFS);
  const [chromeVisible, setChromeVisible] = useState(true);

  const [selection, setSelection] = useState<TextSelectionInfo | null>(null);
  const [quoteSelection, setQuoteSelection] = useState<TextSelectionInfo | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  /** Latest context-menu launcher, so engine events (long-lived lifecycle) never
   *  act on stale state (07 §3). */
  const contextMenuRef = useRef<(x: number, y: number) => void>(() => {});
  useEffect(() => {
    contextMenuRef.current = (x, y) => {
      if (selection) {
        // With text selected, right-click re-anchors the selection toolbar at
        // the cursor (07 §3: "the same actions as the selection toolbar").
        setSelection({ ...selection, rect: { top: y, left: x, bottom: y + 4, right: x } });
      } else {
        setCtxMenu({ x, y });
      }
    };
  }, [selection]);

  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(null);
  const [quoteCardOpen, setQuoteCardOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [pendingSelection, setPendingSelection] = useState<TextSelectionInfo | null>(null);
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false);
  const [shortcutsGuideOpen, setShortcutsGuideOpen] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [navNotice, setNavNotice] = useState<string | null>(null);
  const navNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false,
  );

  const theme = resolveReaderTheme(prefs.theme, systemDark);
  const activePrefs = doc ? prefs : DEFAULT_READING_PREFS;
  // Reading-width cap (04 §3): `maxWidth` constrains the reading column only —
  // chrome, panels and search float over the full window unmoved.
  const readingWidth = activePrefs.maxWidth > 0 ? activePrefs.maxWidth : null;

  /** A failed navigation is surfaced once, from the call site that asked. */
  const showNavNotice = useCallback((message: string) => {
    if (navNoticeTimerRef.current) clearTimeout(navNoticeTimerRef.current);
    setNavNotice(message);
    navNoticeTimerRef.current = setTimeout(() => setNavNotice(null), 4000);
  }, []);

  const reportNavigation = useCallback(
    (pending: Promise<NavigationOutcome>, message: string) => {
      void pending
        .then((outcome) => {
          if (!outcome.ok && !outcome.superseded) showNavNotice(message);
        })
        .catch(() => showNavNotice(message));
    },
    [showNavNotice],
  );

  const announceBookmark = useCallback(
    (result: BookmarkResult) => {
      if (result === "added") showNavNotice("Bookmark added.");
      else if (result === "removed") showNavNotice("Bookmark removed.");
      else if (result === "failed") showNavNotice("Couldn't update the bookmark.");
    },
    [showNavNotice],
  );

  // ---- chapter resolution for annotation targets ---------------------------
  const resolveChapterId = useCallback(
    (location: string | null | undefined): string | null => {
      if (!doc || !location) return null;
      const href = hrefOf(location);
      if (!href) return null;
      const chapter = doc.meta.chapters.find((c) => hrefMatches(c.href, href));
      return chapter?.id ?? null;
    },
    [doc],
  );

  // ---- in-book search (extracted hook) --------------------------------------
  const search = useInBookSearch({ engineRef });

  /** Holds owned outside the chrome hook: dialogs, search, selection and the
   *  context menu (which contributes to the menu hold). Memoized so the
   *  chrome hook's sync effect only runs when one of them actually changes. */
  const holds = useMemo(
    () => [
      { reason: "menu" as ChromeHold, active: ctxMenu !== null },
      {
        reason: "dialog" as ChromeHold,
        active: noteEditorOpen || quoteCardOpen || sessionInfoOpen || shortcutsGuideOpen,
      },
      { reason: "search" as ChromeHold, active: search.open },
      { reason: "selection" as ChromeHold, active: selection !== null },
    ],
    [
      ctxMenu,
      noteEditorOpen,
      quoteCardOpen,
      sessionInfoOpen,
      shortcutsGuideOpen,
      search.open,
      selection,
    ],
  );

  /** Engine events outlive renders; they read focus mode through this ref so a
   *  first-time focus toggle behaves like later ones (E2 stale-closure fix). */
  const isFocusModeRef = useRef(false);

  // ---- annotation data layer, then the engine lifecycle (extracted hooks) --
  const {
    annotations,
    clearAnnotations,
    refreshAnnotations,
    createAnnotation,
    toggleHighlight,
    handleBookmarkToggle,
    bookmarkToggleRef,
  } = useAnnotations({
    docId: doc?.docId,
    engineRef,
    resolveChapterId,
    showNavNotice,
    clearSelection: () => setSelection(null),
  });

  /** New selection from the engine; quote keeps the last selection for Share. */
  const handleEngineSelection = useCallback((sel: TextSelectionInfo | null) => {
    setSelection(sel);
    if (sel) setQuoteSelection(sel);
  }, []);

  const engine = useReaderEngine({
    doc,
    request,
    retryNonce,
    canvasRef,
    engineRef,
    navRef,
    prefsRef,
    chromeRef,
    keepAwakeRef,
    selectionRef,
    contextMenuRef,
    isFocusModeRef,
    previousPercentRef,
    setChromeVisible,
    onSelection: handleEngineSelection,
    reportNavigation,
    refreshAnnotations,
    persistProgress,
  });
  const {
    splash,
    setSplash,
    engineError,
    setEngineError,
    locator,
    setLocator,
    toc,
    seeking,
    paceVersion,
    resetForRetry,
    resetToc,
    writerRef,
    paceRef,
  } = engine;

  // ---- chrome state machine (extracted hook) -------------------------------
  const chrome = useReaderChrome({
    docId: doc?.docId,
    docProgressPercent: doc?.progress?.percent,
    locatorProgression: locator?.progression,
    chromeRef,
    keepAwakeRef,
    setChromeVisible,
    navRef,
    paceRef,
    previousPercentRef,
    holds,
    reportNavigation,
  });

  const { closePanel, exitFocusMode } = chrome;

  useEffect(() => {
    isFocusModeRef.current = chrome.isFocusMode;
  }, [chrome.isFocusMode]);

  useEffect(() => {
    if (status === "error") {
      setEngineError(loadError);
      setSplash("error");
    }
  }, [status, loadError, setEngineError, setSplash]);

  // ---- load the schema-1 doc for the route request -------------------------
  useEffect(() => {
    if (request) void load(request);
  }, [request, load]);

  // ---- OS theme changes (theme === "system") -------------------------------
  useEffect(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => setSystemDark(mq.matches);
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    }
  }, []);

  // ---- adopt the doc's resolved prefs on load -------------------------------
  // Runs on doc identity changes: progress writes replace the doc object, but
  // they write back the same prefs reference, so adoption stays a no-op.
  useEffect(() => {
    if (!doc) return;
    setPrefs(doc.prefs);
    prefsRef.current = doc.prefs;
    savedPrefsRef.current = JSON.stringify(doc.prefs);
  }, [doc, setPrefs]);

  // ---- reset transient reader UI once per document load ---------------------
  // Keyed on docId + retryNonce (never on doc: progress writes must not reset
  // the reader); body reads no doc fields, only stable setters and refs.
  const docId = doc?.docId;
  useEffect(() => {
    if (!docId) return;
    setSplash("loading");
    setEngineError(null);
    setLocator(null);
    resetToc();
    closePanel();
    setCtxMenu(null);
    clearAnnotations();
    exitFocusMode();
    setSessionInfoOpen(false);
    setShortcutsGuideOpen(false);
    setEditingAnnotation(null);
    sessionStartTsRef.current = Date.now();
    previousPercentRef.current = null;
  }, [
    docId,
    retryNonce,
    setSplash,
    setEngineError,
    setLocator,
    resetToc,
    closePanel,
    clearAnnotations,
    exitFocusMode,
    setCtxMenu,
    setSessionInfoOpen,
    setShortcutsGuideOpen,
  ]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // ---- debounced per-book prefs writes ------------------------------------
  useEffect(() => {
    if (!docId) return;
    prefsRef.current = prefs;
    void engineRef.current?.applyPrefs(prefs);
    const serialized = JSON.stringify(prefs);
    if (serialized === savedPrefsRef.current) return;
    const timer = setTimeout(() => {
      savedPrefsRef.current = serialized;
      void savePrefs(prefs);
    }, 400);
    return () => clearTimeout(timer);
  }, [prefs, docId, savePrefs, engineRef, prefsRef, savedPrefsRef]);

  // Flush progress before the window goes away. `beforeunload` is not
  // guaranteed to finish async work in WebView2, so Tauri's close request is
  // intercepted, awaited (with a cap), and only then destroyed.
  useEffect(() => {
    if (!docId) return;

    const flush = () => {
      void writerRef.current?.flush();
      void keepAwakeRef.current?.release();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);

    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();
          const un = await win.onCloseRequested(async (event) => {
            event.preventDefault();
            try {
              await withTimeout(
                Promise.all([writerRef.current?.flush(), keepAwakeRef.current?.release()]),
                CLOSE_FLUSH_CAP_MS,
              );
            } catch {
              // A hung write must not keep the window alive forever.
            }
            try {
              await win.destroy();
            } catch {
              // If destroy is unavailable, fall back to the pending OS close.
            }
          });
          if (disposed) un();
          else unlisten = un;
        } catch {
          // Browser dev or a missing capability: beforeunload still flushes.
        }
      })();
    }

    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      unlisten?.();
    };
  }, [docId, writerRef, keepAwakeRef]);

  useEffect(() => {
    return () => {
      if (navNoticeTimerRef.current) clearTimeout(navNoticeTimerRef.current);
    };
  }, []);

  const handleBack = useCallback(async () => {
    if (disposedRef.current) return;
    disposedRef.current = true;
    const { flushFailed } = await flushAndClose(
      () => writerRef.current?.flush(),
      () => keepAwakeRef.current?.release(),
      () => {
        closeDoc();
        closeReader();
      },
    );
    if (flushFailed) {
      pushToast({ tone: "error", text: "Last page position may not have saved" });
    }
  }, [closeDoc, closeReader, writerRef, keepAwakeRef]);

  const handleRetry = useCallback(() => {
    resetForRetry();
    previousPercentRef.current = null;
    setRetryNonce((n) => n + 1);
    if (request && status === "error") void load(request);
  }, [resetForRetry, load, request, status]);

  const handlePrefsChange = useCallback((next: ReadingPrefs) => {
    setPrefs(next);
    prefsRef.current = next;
    void engineRef.current?.applyPrefs(next);
  }, []);

  const handleReset = useCallback(async () => {
    await resetPrefs();
    const next = useReaderStore.getState().doc?.prefs;
    if (next) {
      savedPrefsRef.current = JSON.stringify(next);
      setPrefs(next);
      prefsRef.current = next;
      void engineRef.current?.applyPrefs(next);
    }
  }, [resetPrefs]);

  // ---- keyboard matrix (extracted hook, 07 §1) -----------------------------
  useReaderKeyboard({
    doc,
    engineRef,
    navRef,
    chromeRef,
    bookmarkToggleRef,
    isFocusMode: chrome.isFocusMode,
    toggleFocusMode: chrome.toggleFocusMode,
    exitFocusMode: chrome.exitFocusMode,
    panel: chrome.panel,
    closePanel: chrome.closePanel,
    togglePanel: chrome.togglePanel,
    menuOpenRef: chrome.menuOpenRef,
    setMenu: chrome.setMenu,
    searchOpen: search.open,
    setSearchOpen: search.setOpen,
    clearSelection: () => setSelection(null),
    ctxMenu,
    clearCtxMenu: () => setCtxMenu(null),
    noteEditorOpen,
    closeNoteEditor: () => {
      setNoteEditorOpen(false);
      setEditingAnnotation(null);
      setPendingSelection(null);
    },
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
  });

  const handleCopySelection = useCallback(
    async (quote: string) => {
      try {
        await navigator.clipboard.writeText(quote);
        showNavNotice("Copied to clipboard.");
      } catch (e) {
        handleError(e, {
          context: "reader.clipboard",
          userMessage: describeError(e, "The text could not be copied."),
        });
      }
      setSelection(null);
    },
    [showNavNotice],
  );

  const openNoteEditor = useCallback((sel: TextSelectionInfo) => {
    setEditingAnnotation(null);
    setPendingSelection(sel);
    setNoteDraft("");
    setNoteEditorOpen(true);
    setSelection(null);
  }, []);

  const saveNote = useCallback(async () => {
    if (editingAnnotation) {
      const lm = getLibraryManager();
      try {
        await lm.annotations.update(editingAnnotation.id, {
          note: noteDraft.trim() || null,
          updatedAt: nowIso(),
        });
      } catch (e) {
        // Keep the dialog open with the draft so a transient write failure
        // can be retried (same contract as NotesScreen.handleEditSave).
        handleError(e, {
          context: "reader.annotations.update",
          userMessage: describeError(e, "The note could not be saved."),
        });
        return;
      }
      if (doc) {
        try {
          await refreshAnnotations(doc.docId);
        } catch (e) {
          handleError(e, { context: "reader.annotations.refresh" });
        }
      }
      showNavNotice("Note updated.");
      setNoteEditorOpen(false);
      setEditingAnnotation(null);
      setNoteDraft("");
      return;
    }
    if (!pendingSelection) return;
    const saved = await createAnnotation(
      pendingSelection,
      "note",
      "yellow",
      noteDraft.trim() || null,
    );
    if (!saved) return; // dialog stays open with the draft intact
    showNavNotice("Note saved.");
    setNoteEditorOpen(false);
    setPendingSelection(null);
    setNoteDraft("");
  }, [
    editingAnnotation,
    pendingSelection,
    noteDraft,
    doc,
    refreshAnnotations,
    createAnnotation,
    showNavNotice,
  ]);

  const goToHref = useCallback(
    (href: string, origin: NavigationOrigin = "contents"): Promise<NavigationOutcome> => {
      const nav = navRef.current;
      if (!nav) {
        return Promise.resolve({
          ok: false,
          superseded: false,
          reason: "The reader is not ready yet.",
        });
      }
      return nav.goToHref(href, origin);
    },
    [],
  );

  const handleTurn = useCallback(
    (direction: "next" | "previous") => {
      const nav = navRef.current;
      if (!nav) return;
      reportNavigation(
        nav[direction]("button"),
        direction === "next" ? "Couldn't turn the page forward." : "Couldn't turn the page back.",
      );
    },
    [reportNavigation],
  );

  const onReaderContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        ".folio-reader-chrome, .folio-panel, .folio-overlay, .folio-reader-menu, .folio-reader-ctxmenu, .folio-inbook-search-panel, .folio-selection-toolbar, [role='dialog'], .folio-snackbar, .folio-reader-splash, .folio-reader-focus-exit",
      )
    ) {
      return;
    }
    e.preventDefault();
    contextMenuRef.current(e.clientX, e.clientY);
  }, []);

  const title = doc?.title ?? (request ? "Opening book…" : "Reader");
  const chapterTitle =
    locator?.chapterTitle ??
    doc?.meta.chapters.find((c) => hrefMatches(c.href, locator?.chapterHref))?.title ??
    title;
  const percent =
    chrome.scrubValue ??
    (locator?.progression !== undefined
      ? locator.progression * 100
      : (doc?.progress?.percent ?? 0));
  const timeLeft = useMemo(
    () => {
      // paceVersion is the reactive invalidation token for the ref read below.
      void paceVersion;
      return formatTimeLeft(paceRef.current?.timeLeftMinutes(percent) ?? null);
    },
    // paceRef is the live (non-reactive) value.
    [paceVersion, percent, paceRef],
  );
  const backLabel = backLabelFor(readerOrigin?.route);
  const bookmarked = useMemo(
    () =>
      !!locator &&
      annotations.some((a) => a.kind === "bookmark" && sameLocation(a.location, locator.location)),
    [annotations, locator],
  );

  const tint = doc?.meta.contentHash ? tintIndexFromHash(doc.meta.contentHash) : 0;
  const splashPhase: SplashPhase = status === "error" || splash === "error" ? "error" : splash;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- full-surface reader canvas; all actions have keyboard shortcuts (07 §1)
    <div
      className={`folio-reader${chrome.isFocusMode ? " is-focus-mode" : ""}`}
      style={
        {
          "--reader-bg": theme.pageBg,
          "--reader-text": theme.pageText,
          "--reader-chrome-surface": theme.chromeSurface,
          "--reader-chrome-text": theme.chromeText,
          background: theme.pageBg,
          color: theme.pageText,
        } as CSSProperties
      }
      onMouseMove={chrome.onMouseMove}
      onClick={chrome.onReaderSurfaceClick}
      onContextMenu={onReaderContextMenu}
    >
      <div
        ref={canvasRef}
        className="folio-reader__canvas"
        style={readingWidth ? { maxWidth: readingWidth, margin: "0 auto" } : undefined}
      />

      <div
        className="folio-reader__scrim"
        style={{ opacity: scrimAlpha(activePrefs.brightness) }}
        aria-hidden="true"
      />

      {doc && (
        <>
          <ReaderChrome
            visible={chromeVisible && splashPhase === "done" && !chrome.isFocusMode}
            backLabel={backLabel}
            title={title}
            chapterTitle={chapterTitle}
            percent={percent}
            timeLeft={timeLeft}
            scrubValue={chrome.scrubValue}
            seeking={seeking}
            bookmarked={bookmarked}
            menuOpen={chrome.menuOpen}
            onMenuChange={chrome.setMenu}
            onBack={() => void handleBack()}
            onAppearance={() => chrome.openPanel("appearance")}
            onContents={() => chrome.openPanel("toc")}
            onSearch={() => {
              search.setOpen((v) => !v);
              chromeRef.current?.onActivity();
              setChromeVisible(true);
            }}
            onBookmark={() => void handleBookmarkToggle().then(announceBookmark)}
            onShareQuote={() => setQuoteCardOpen(true)}
            shareEnabled={!!quoteSelection}
            onToggleChrome={chrome.handleToggleChrome}
            onHold={chrome.handleChromeHold}
            onPrevious={() => handleTurn("previous")}
            onNext={() => handleTurn("next")}
            onScrubStart={chrome.handleScrubStart}
            onScrubChange={chrome.handleScrubChange}
            onScrubEnd={chrome.handleScrubEnd}
            isFocusMode={chrome.isFocusMode}
            onFocusMode={chrome.toggleFocusMode}
            onSessionInfo={() => setSessionInfoOpen(true)}
            onShortcutsGuide={() => setShortcutsGuideOpen(true)}
          />

          <InBookSearchPanel
            open={search.open}
            query={search.query}
            results={search.results}
            isSearching={search.searching}
            searchError={search.error}
            onQueryChange={search.setQuery}
            onClear={search.clear}
            onClose={() => search.setOpen(false)}
            onSelectResult={(loc) => {
              reportNavigation(goToHref(loc, "search"), "Couldn't reach that search result.");
            }}
          />

          {ctxMenu && (
            <ReaderContextMenu
              x={ctxMenu.x}
              y={ctxMenu.y}
              onClose={() => setCtxMenu(null)}
              onToggleChrome={() => {
                chromeRef.current?.toggle();
                setChromeVisible(chromeRef.current?.visible ?? false);
              }}
              onToc={() => chrome.openPanel("toc")}
              onBookmark={() => void handleBookmarkToggle().then(announceBookmark)}
            />
          )}

          <AppearancePanel
            open={chrome.panel === "appearance"}
            prefs={activePrefs}
            onClose={chrome.closePanel}
            onChange={handlePrefsChange}
            onReset={() => void handleReset()}
          />

          <TocPanel
            open={chrome.panel === "toc"}
            initialTab={chrome.workspaceTab}
            entries={toc}
            currentHref={locator?.chapterHref}
            annotations={annotations}
            chapters={doc?.meta.chapters}
            onClose={chrome.closePanel}
            onSelect={(href) => goToHref(href, "contents")}
            onSelectAnnotation={(target) => navRef.current?.goToAnnotation(target, "annotation")}
            onRemoveBookmark={async (id) => {
              try {
                await getLibraryManager().annotations.remove(id);
                await refreshAnnotations(doc.docId);
                showNavNotice("Bookmark removed.");
              } catch (e) {
                handleError(e, {
                  context: "reader.annotations.remove",
                  userMessage: "The bookmark could not be removed.",
                });
              }
            }}
            onDeleteAnnotation={async (id) => {
              try {
                await getLibraryManager().annotations.remove(id);
                await refreshAnnotations(doc.docId);
                showNavNotice("Annotation deleted.");
              } catch (e) {
                handleError(e, {
                  context: "reader.annotations.remove",
                  userMessage: "The item could not be deleted.",
                });
              }
            }}
            onEditNote={(a) => {
              setEditingAnnotation(a);
              setNoteDraft(a.note ?? "");
              setNoteEditorOpen(true);
            }}
          />

          <ReadingSessionDialog
            open={sessionInfoOpen}
            onClose={() => setSessionInfoOpen(false)}
            title={title}
            chapterTitle={chapterTitle}
            percent={percent}
            timeLeft={timeLeft}
            sessionDurationMs={Date.now() - sessionStartTsRef.current}
            totalReadingTimeMs={doc?.progress?.pace?.sessionsMs ?? 0}
            totalChapters={doc?.meta.chapters.length}
          />

          <KeyboardShortcutsDialog
            open={shortcutsGuideOpen}
            onClose={() => setShortcutsGuideOpen(false)}
          />

          <QuoteCard
            open={quoteCardOpen}
            onClose={() => setQuoteCardOpen(false)}
            quote={quoteSelection?.quote ?? ""}
            title={title}
            author={doc?.author ?? null}
          />

          {selection && (
            <SelectionToolbar
              rect={selection.rect}
              onHighlight={(color) => void toggleHighlight(color, selection)}
              onNote={() => openNoteEditor(selection)}
              onCopy={() => void handleCopySelection(selection.quote)}
            />
          )}

          <FolioDialog
            open={noteEditorOpen}
            onClose={() => {
              setNoteEditorOpen(false);
              setEditingAnnotation(null);
              setPendingSelection(null);
            }}
            title={editingAnnotation ? "Edit note" : "Add note"}
            actions={
              <>
                <FolioButton
                  variant="secondary"
                  onClick={() => {
                    setNoteEditorOpen(false);
                    setEditingAnnotation(null);
                    setPendingSelection(null);
                  }}
                >
                  Cancel
                </FolioButton>
                <FolioButton variant="primary" onClick={() => void saveNote()}>
                  Save
                </FolioButton>
              </>
            }
          >
            {(editingAnnotation?.quote || pendingSelection?.quote) && (
              <blockquote className="folio-note-quote">
                {editingAnnotation?.quote ?? pendingSelection?.quote}
              </blockquote>
            )}
            <textarea
              className="folio-note-input"
              rows={4}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Add personal note…"
              autoFocus
              data-autofocus
            />
          </FolioDialog>
        </>
      )}

      {navNotice && (
        <div className="folio-snackbar folio-snackbar--warn" role="status">
          {navNotice}
        </div>
      )}

      <ReaderSplash
        phase={splashPhase}
        title={title}
        author={doc?.author ?? null}
        coverUrl={doc?.coverUrl ?? null}
        tint={tint}
        errorMessage={engineError ?? loadError}
        onRetry={handleRetry}
        onBack={() => void handleBack()}
      />

      {!request && status !== "loading" && (
        <div className="folio-reader-empty">
          <p>Open a book from your library to start reading.</p>
        </div>
      )}
    </div>
  );
}
