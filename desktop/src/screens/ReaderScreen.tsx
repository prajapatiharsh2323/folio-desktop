import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EpubAppearancePanel } from "../components/AppearancePanel";
import { PdfAppearancePanel } from "../components/PdfAppearancePanel";
import { PdfThumbnailStrip } from "../components/PdfThumbnailStrip";
import { ReaderChrome } from "../components/ReaderChrome";
import { ReaderContextMenu } from "../components/ReaderContextMenu";
import { FootnotePopover } from "../components/FootnotePopover";
import { DecorationPopover } from "../components/DecorationPopover";
import { ReaderSplash, type SplashPhase } from "../components/ReaderSplash";
import { TocPanel } from "../components/TocPanel";
import { InBookSearchPanel } from "../components/InBookSearchPanel";
import { ReadingSessionDialog } from "../components/ReadingSessionDialog";
import { KeyboardShortcutsDialog } from "../components/KeyboardShortcutsDialog";
import { SelectionToolbar } from "../components/SelectionToolbar";
import { AnnotationPopover } from "../components/AnnotationPopover";
import { QuoteCard } from "../components/QuoteCard";
import { FolioDialog } from "../components/FolioDialog";
import { FolioButton } from "../components/FolioButton";
import { tintIndexFromHash } from "../import/cover";
import type {
  NoterefActivation,
  HighlightActivation,
  TextSelectionInfo,
} from "../reader/ReaderEngine";
import { useReaderStore } from "../store/readerStore";
import { useRouteStore } from "../store/routeStore";
import { getLibraryManager } from "../store/libraryUi";
import type { EpubPrefs } from "../store/epubPrefs";
import { pushToast } from "../shell/toasts";
import { describeError, handleError } from "../lib/errorLog";
import { APP_WINDOW_TITLE, bookWindowTitle, setWindowTitle } from "../lib/windowTitle";
import { DEFAULT_READING_PREFS, clampFontSize } from "../model/defaults";
import type { TextSizeAction } from "./reader/useReaderKeyboard";
import type { ReadingPrefs, Annotation } from "../model/types";
import { pdfToReadingPrefs, type PdfReaderPrefs } from "../model/formatPrefs";
import { nowIso } from "../model/ids";
import { findOverlappingHighlight } from "./reader/annotationOverlap";
import { citationFor } from "./reader/citation";
import type { ReaderEngine } from "../reader/ReaderEngine";
import { ChromeStateMachine, type ChromeHold } from "../reader/chrome";
import type {
  NavigationOrigin,
  NavigationOutcome,
  ReaderNavigationCoordinator,
} from "../reader/navigation";
import { flushAndClose } from "../lib/lifecycle";
import { formatTimeLeft, formatChapterTimeLeft } from "../reader/pace";
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
  /** F9 5.2c: line-focus reading band — session state like focus mode (not a
   *  persisted pref; it's a momentary aid, not an appearance setting). */
  const [lineFocusOpen, setLineFocusOpen] = useState(false);

  const [selection, setSelection] = useState<TextSelectionInfo | null>(null);
  const [quoteSelection, setQuoteSelection] = useState<TextSelectionInfo | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  /** Noteref footnote popover content (R4 2.2b); null closes it. */
  const [footnote, setFootnote] = useState<NoterefActivation | null>(null);
  /** Highlight popover target (R5): the annotation + its activation point. */
  const [highlightPop, setHighlightPop] = useState<{
    annotation: Annotation;
    x: number;
    y: number;
  } | null>(null);
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

  /** Clicked-highlight popover (PDF, R5): anchored at the click, offering
   *  note editing and removal. Resolved lazily — the engine only reports the
   *  decoration id, the annotation lookup happens when the popover opens. */
  const [decorPopover, setDecorPopover] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const decorationClickRef = useRef<(id: string, at?: { x: number; y: number }) => void>(() => {});
  useEffect(() => {
    decorationClickRef.current = (id, at) => {
      setDecorPopover({
        id,
        x: at?.x ?? window.innerWidth / 2,
        y: at?.y ?? window.innerHeight / 2,
      });
    };
  }, []);

  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(null);
  const [quoteCardOpen, setQuoteCardOpen] = useState(false);
  /** R11: end-of-book card — raised when the reading position reaches 100%. */
  const [endCardOpen, setEndCardOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [pendingSelection, setPendingSelection] = useState<TextSelectionInfo | null>(null);
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false);
  const [shortcutsGuideOpen, setShortcutsGuideOpen] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false,
  );

  const theme = resolveReaderTheme(prefs.theme, systemDark);
  const isPdf = doc?.format === "pdf";
  const docIdRef = useRef<string | undefined>(doc?.docId);
  docIdRef.current = doc?.docId;
  const docIdForPrefs = doc?.docId;
  const docFormatForPrefs = doc?.format;
  /** Declared before the engine hook so a fresh engine can read PDF prefs at open. */
  const pdfPrefsRef = useRef<PdfReaderPrefs | null>(null);
  const epubPrefsRef = useRef<EpubPrefs | null>(null);
  const activePrefs = doc ? prefs : DEFAULT_READING_PREFS;
  // Reading-width cap (04 §3): `maxWidth` constrains the reading column only —
  // chrome, panels and search float over the full window unmoved.
  // Fixed-layout pages size themselves from the PDF layout; an EPUB reading
  // width cap must never narrow the PDF canvas.
  const readingWidth = !isPdf && activePrefs.maxWidth > 0 ? activePrefs.maxWidth : null;

  /** A failed navigation is surfaced once, from the call site that asked.
   *  R14: this is a keyed info toast in the global host (stacked, shown once
   *  even when the same message fires twice, auto-dismissed after 4 s). */
  const showNavNotice = useCallback((message: string) => {
    pushToast({ tone: "info", key: message, text: message });
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

  /** R4: return through the position history (Alt+Left, toast Back action). */
  const goBackInHistory = useCallback(() => {
    const nav = navRef.current;
    if (nav) reportNavigation(nav.goBack(), "Couldn't go back.");
  }, [reportNavigation, navRef]);

  /** R4/X1: re-advance through positions abandoned by Back (Alt+Right). */
  const goForwardInHistory = useCallback(() => {
    const nav = navRef.current;
    if (nav) reportNavigation(nav.goForward(), "Couldn't go forward.");
  }, [reportNavigation, navRef]);

  /** Offer a way back right after an in-content internal link lands. */
  const onInternalLinkMoved = useCallback(() => {
    pushToast({
      tone: "info",
      text: "Jumped to a linked location.",
      action: { label: "Back", run: goBackInHistory },
    });
  }, [goBackInHistory]);

  /** Noteref tap: show the footnote popover; a failed extraction is a notice. */
  const onNoterefActivation = useCallback(
    (activation: NoterefActivation | null) => {
      if (!activation) {
        showNavNotice("Couldn't open that footnote.");
        return;
      }
      setFootnote(activation);
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

  /** Holds owned outside the chrome hook: dialogs, selection and the
   *  context menu (which contributes to the menu hold). Search is covered by
   *  the panel hold since its open state lives in the chrome (R8). Memoized
   *  so the chrome hook's sync effect only runs when one actually changes. */
  const holds = useMemo(
    () => [
      { reason: "menu" as ChromeHold, active: ctxMenu !== null || decorPopover !== null },
      {
        reason: "dialog" as ChromeHold,
        active: noteEditorOpen || quoteCardOpen || sessionInfoOpen || shortcutsGuideOpen,
      },
      { reason: "selection" as ChromeHold, active: selection !== null },
    ],
    [
      ctxMenu,
      decorPopover,
      noteEditorOpen,
      quoteCardOpen,
      sessionInfoOpen,
      shortcutsGuideOpen,
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
    updateAnnotation,
    deleteAnnotation,
    handleBookmarkToggle,
    bookmarkToggleRef,
  } = useAnnotations({
    docId: doc?.docId,
    engineRef,
    resolveChapterId,
    showNavNotice,
    clearSelection: () => setSelection(null),
    theme,
  });

  /** The engine's highlight-activation callback outlives renders; it reads
   *  the current annotations through this ref (E2 stale-closure pattern). */
  const annotationsRef = useRef<Annotation[]>([]);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  /** New selection from the engine. R6: the quote follows the *live*
   *  selection — a selection end (null) clears it too, so Share never acts
   *  on stale text. */
  const handleEngineSelection = useCallback((sel: TextSelectionInfo | null) => {
    setSelection(sel);
    setQuoteSelection(sel);
  }, []);

  /** Highlight click (R5): open the annotation popover at the click point. */
  const onHighlightActivation = useCallback((activation: HighlightActivation) => {
    const annotation = annotationsRef.current.find(
      (a) => a.id === activation.id && a.kind === "highlight",
    );
    if (!annotation) return false; // stale/unpainted decoration: default click
    setHighlightPop({ annotation, x: activation.x, y: activation.y });
    return true;
  }, []);

  const engine = useReaderEngine({
    doc,
    request,
    retryNonce,
    canvasRef,
    engineRef,
    navRef,
    prefsRef,
    pdfPrefsRef,
    epubPrefsRef,
    chromeRef,
    keepAwakeRef,
    selectionRef,
    contextMenuRef,
    decorationClickRef,
    isFocusModeRef,
    previousPercentRef,
    setChromeVisible,
    onSelection: handleEngineSelection,
    reportNavigation,
    onInternalLinkMoved,
    onNoterefActivation,
    onHighlightActivation,
    refreshAnnotations,
    persistProgress,
  });
  const {
    splash,
    setSplash,
    splashProgress,
    engineError,
    setEngineError,
    locator,
    setLocator,
    toc,
    capabilities,
    seeking,
    paceVersion,
    resetForRetry,
    resetToc,
    writerRef,
    paceRef,
  } = engine;

  // PDF zoom lives in the engine (session state), but the appearance panel
  // needs a reactive value to display. Zoom only changes through the panel's
  // callbacks, so a mirror here stays honest (PDF plan §8.4).
  const [pdfZoom, setPdfZoom] = useState<"fit-width" | "fit-page" | number>("fit-width");
  useEffect(() => {
    // New document: the engine always starts at its default zoom.
    setPdfZoom("fit-width");
  }, [doc?.docId]);
  const handleZoomBy = useCallback(async (direction: 1 | -1) => {
    const engineInstance = engineRef.current;
    if (!engineInstance?.zoomBy) return;
    await engineInstance.zoomBy(direction);
    const next = engineInstance.getZoom?.();
    if (typeof next === "number" || next === "fit-width" || next === "fit-page") {
      setPdfZoom(next);
    }
  }, []);
  const handleZoomMode = useCallback(async (mode: "fit-width" | "fit-page") => {
    const engineInstance = engineRef.current;
    if (!engineInstance?.setZoom) return;
    await engineInstance.setZoom(mode);
    setPdfZoom(mode);
  }, []);

  // ---- format-specific preferences -----------------------------------------
  // PDF settings live in an additive desktop-only file; EPUB typography keeps
  // using the schema-1 per-doc override. Neither format touches the other.
  const [pdfPrefs, setPdfPrefs] = useState<PdfReaderPrefs | null>(null);
  const savedPdfPrefsRef = useRef<string | null>(null);
  pdfPrefsRef.current = pdfPrefs;

  useEffect(() => {
    let cancelled = false;
    if (!docIdForPrefs || docFormatForPrefs !== "pdf") {
      setPdfPrefs(null);
      savedPdfPrefsRef.current = null;
      return;
    }
    void getLibraryManager()
      .pdfPrefs.resolved(docIdForPrefs)
      .then((next) => {
        if (cancelled) return;
        savedPdfPrefsRef.current = JSON.stringify(next);
        setPdfPrefs(next);
      })
      .catch((error) => handleError(error, { context: "reader.pdfPrefs.load" }));
    return () => {
      cancelled = true;
    };
  }, [docIdForPrefs, docFormatForPrefs]);

  const [epubPrefs, setEpubPrefs] = useState<EpubPrefs | null>(null);
  epubPrefsRef.current = epubPrefs;

  useEffect(() => {
    let cancelled = false;
    if (!docIdForPrefs || docFormatForPrefs !== "epub") {
      setEpubPrefs(null);
      return;
    }
    void getLibraryManager()
      .epubPrefs.resolved(docIdForPrefs)
      .then((next) => {
        if (!cancelled) setEpubPrefs(next);
      })
      .catch((error) => handleError(error, { context: "reader.epubPrefs.load" }));
    return () => {
      cancelled = true;
    };
  }, [docIdForPrefs, docFormatForPrefs]);

  // Apply as soon as both the engine and the additive prefs are available.
  useEffect(() => {
    if (!isPdf || !pdfPrefs) return;
    void engineRef.current?.applyPdfPrefs?.(pdfPrefs);
  }, [isPdf, pdfPrefs, engineRef]);

  useEffect(() => {
    if (isPdf || !epubPrefs) return;
    void engineRef.current?.applyEpubPrefs?.(epubPrefs);
  }, [isPdf, epubPrefs, engineRef]);

  const handlePublisherColorsChange = useCallback((value: boolean) => {
    setEpubPrefs((current) => {
      const next: EpubPrefs = {
        ...(current ?? { respectPublisherColors: false }),
        respectPublisherColors: value,
      };
      void engineRef.current?.applyEpubPrefs?.(next);
      void getLibraryManager()
        .epubPrefs.writeDocOverride(docIdRef.current ?? "", next)
        .catch((error) => handleError(error, { context: "reader.epubPrefs.save" }));
      return next;
    });
  }, []);

  const handlePdfPrefsChange = useCallback((next: PdfReaderPrefs) => {
    setPdfPrefs(next);
    void engineRef.current?.applyPdfPrefs?.(next);
    // Also send the shared fields through the engine-facing ReadingPrefs seam.
    void engineRef.current?.applyPrefs(pdfToReadingPrefs(next));
    void getLibraryManager()
      .pdfPrefs.writeDocOverride(docIdRef.current ?? "", next)
      .catch((error) => handleError(error, { context: "reader.pdfPrefs.save" }));
  }, []);

  const handlePdfReset = useCallback(async () => {
    const manager = getLibraryManager();
    if (docIdRef.current) await manager.pdfPrefs.removeDocOverride(docIdRef.current);
    const next = await manager.pdfPrefs.global();
    savedPdfPrefsRef.current = JSON.stringify(next);
    setPdfPrefs(next);
    void engineRef.current?.applyPdfPrefs?.(next);
    void engineRef.current?.applyPrefs(pdfToReadingPrefs(next));
  }, []);

  const handleZoomActual = useCallback(async () => {
    const engineInstance = engineRef.current;
    if (!engineInstance?.setZoom) return;
    await engineInstance.setZoom(1);
    setPdfZoom(1);
  }, []);

  const handleGoPage = useCallback(
    (page: number) => {
      void navRef.current?.goToHref(`page-${page}`, "slider");
    },
    [navRef],
  );

  const handleRenderThumbnail = useCallback(
    async (p: number) => (await engineRef.current?.renderThumbnail?.(p)) ?? null,
    [engineRef],
  );

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

  // PDF full-screen focus workspace: hide the chrome and request native
  // fullscreen. User-driven focus toggles stay independent of this pref.
  const focusModeRef = useRef(false);
  focusModeRef.current = chrome.isFocusMode;
  const toggleFocusMode = chrome.toggleFocusMode;
  useEffect(() => {
    if (!isPdf || !pdfPrefs) return;
    const want = pdfPrefs.focusWorkspace;
    if (focusModeRef.current !== want) toggleFocusMode();
    try {
      if (want && !document.fullscreenElement) {
        void document.documentElement.requestFullscreen?.().catch(() => {});
      }
      if (!want && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    } catch {
      /* fullscreen is best-effort (CSP / host window constraints) */
    }
  }, [isPdf, pdfPrefs, toggleFocusMode]);

  // ---- in-book search (extracted hook) ---------------------------------------
  // Open state lives in the chrome's single panel slot (R8): search, TOC and
  // Appearance are mutually exclusive, and the panel hold pins the chrome.
  const isSearchOpen = chrome.panel === "search";
  const search = useInBookSearch({
    engineRef,
    navRef,
    open: isSearchOpen,
    onOpenChange: (next) => (next ? chrome.openPanel("search") : chrome.closePanel()),
    theme,
  });

  useEffect(() => {
    isFocusModeRef.current = chrome.isFocusMode;
  }, [chrome.isFocusMode]);

  // A move makes the footnote popover's anchor point stale (R4 2.2b), and the
  // highlight popover likewise (R5).
  useEffect(() => {
    setFootnote(null);
    setHighlightPop(null);
  }, [locator]);

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

  // ---- OS theme changes (theme === "system", R9) -----------------------------
  // The host chrome re-themes via the systemDark state, and the engine is
  // told to re-submit prefs so the book canvas repaints too.
  useEffect(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        setSystemDark(mq.matches);
        void engineRef.current?.setSystemDark(mq.matches);
      };
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    }
  }, [engineRef]);

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
    setPendingSelection(null);
    setQuoteSelection(null);
    setEndCardOpen(false);
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

  /** R13: Ctrl+=/−/0 size this book's text up, down, or back to default. */
  const adjustTextSize = useCallback(
    (action: TextSizeAction) => {
      const current = activePrefs.fontSize;
      const next =
        action === "reset"
          ? DEFAULT_READING_PREFS.fontSize
          : clampFontSize(current + (action === "larger" ? 1 : -1));
      if (action !== "reset" && next === current) return;
      handlePrefsChange({ ...activePrefs, fontSize: next });
      showNavNotice(action === "reset" ? "Text size reset." : `Text size ${next}px.`);
    },
    [activePrefs, handlePrefsChange, showNavNotice],
  );

  /** F9 5.2c: toggle the line-focus reading band (`L`). EPUB (reflowable)
   *  only — a fixed PDF page already fills its layout, and a ruler over it
   *  would cover artwork the layout intends to show whole. */
  const toggleLineFocus = useCallback(() => {
    if (!doc || doc.format === "pdf") return;
    setLineFocusOpen((open) => !open);
  }, [doc]);

  /** R13: `[` / `]` step chapter by chapter in the TOC order; adjacent
   *  TOC entries sharing the current chapter's href count as one stop. */
  const stepChapter = useCallback(
    (direction: "next" | "previous") => {
      const nav = navRef.current;
      if (!nav || toc.length === 0) return;
      const currentHref = locator?.chapterHref ?? null;
      const index = currentHref
        ? toc.findIndex((entry) => hrefMatches(entry.href, currentHref))
        : -1;
      if (index === -1) return;
      const step = direction === "next" ? 1 : -1;
      let target = -1;
      for (let i = index + step; i >= 0 && i < toc.length; i += step) {
        if (!hrefMatches(toc[i].href, currentHref)) {
          target = i;
          break;
        }
      }
      if (target === -1) return; // already at the first/last chapter
      reportNavigation(
        nav.goToHref(toc[target].href, "keyboard"),
        direction === "next"
          ? "Couldn't move to the next chapter."
          : "Couldn't move to the previous chapter.",
      );
    },
    [toc, locator, navRef, reportNavigation],
  );

  const handleReset = useCallback(async () => {
    // EPUB reset clears only EPUB-owned overrides, including the additive
    // Publisher presentation flag; PDF preferences are untouched.
    if (docIdRef.current) await getLibraryManager().epubPrefs.removeDocOverride(docIdRef.current);
    setEpubPrefs({ respectPublisherColors: false });
    void engineRef.current?.applyEpubPrefs?.({ respectPublisherColors: false });
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
    lineFocusOpen,
    toggleLineFocus,
    panel: chrome.panel,
    closePanel: chrome.closePanel,
    togglePanel: chrome.togglePanel,
    menuOpenRef: chrome.menuOpenRef,
    setMenu: chrome.setMenu,
    toggleSearch: search.toggle,
    searchNext: search.moveNext,
    searchPrev: search.movePrev,
    goBack: goBackInHistory,
    goForward: goForwardInHistory,
    onTextSize: adjustTextSize,
    stepChapter,
    clearSelection: () => setSelection(null),
    ctxMenu,
    clearCtxMenu: () => setCtxMenu(null),
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
      setQuoteSelection(null); // R6: the quote never outlives the selection
    },
    [showNavNotice],
  );

  /** R6: quote plus a citation line (title, author when present). */
  const handleCopyCitation = useCallback(
    async (sel: TextSelectionInfo) => {
      const citation = citationFor(
        sel.quote,
        doc?.title ?? (request ? "Opening book…" : "Reader"),
        doc?.author ?? null,
      );
      await handleCopySelection(citation);
    },
    [doc, request, handleCopySelection],
  );

  const openNoteEditor = useCallback((sel: TextSelectionInfo) => {
    setEditingAnnotation(null);
    setPendingSelection(sel);
    setNoteDraft("");
    setNoteEditorOpen(true);
    setSelection(null);
  }, []);

  /** Popover action: open the note editor for an existing highlight. */
  const editDecorationNote = useCallback(
    (id: string) => {
      const annotation = annotations.find((a) => a.id === id) ?? null;
      setDecorPopover(null);
      if (!annotation) return;
      setEditingAnnotation(annotation);
      setNoteDraft(annotation.note ?? "");
      setNoteEditorOpen(true);
    },
    [annotations],
  );

  /** Popover action: remove the highlight (same path as the TOC panel's
   *  delete), then repaint the page decorations. */
  const removeDecoration = useCallback(
    async (id: string) => {
      setDecorPopover(null);
      if (!doc) return;
      try {
        await getLibraryManager().annotations.remove(id);
        await refreshAnnotations(doc.docId);
        showNavNotice("Highlight removed.");
      } catch (e) {
        handleError(e, {
          context: "reader.annotations.remove",
          userMessage: "The highlight could not be removed.",
        });
      }
    },
    [doc, refreshAnnotations, showNavNotice],
  );

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

  // X1: the OS window title tracks the open book and resets on close.
  const titleDocId = doc?.docId;
  const docTitle = doc?.title;
  useEffect(() => {
    if (!titleDocId || !docTitle) return;
    void setWindowTitle(bookWindowTitle(docTitle));
    return () => {
      void setWindowTitle(APP_WINDOW_TITLE);
    };
  }, [titleDocId, docTitle]);

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
  const finished = percent >= 100;

  // R11: reaching the end of the book raises the end-of-book card once per
  // visit; dismissing it keeps it closed until the position leaves 100%.
  useEffect(() => {
    if (finished) setEndCardOpen(true);
  }, [finished]);
  const timeLeft = useMemo(
    () => {
      // paceVersion is the reactive invalidation token for the ref read below.
      void paceVersion;
      return formatTimeLeft(paceRef.current?.timeLeftMinutes(percent) ?? null);
    },
    // paceRef is the live (non-reactive) value.
    [paceVersion, percent, paceRef],
  );

  // ---- R11: chapter ticks + per-chapter time -------------------------------
  /** Start percent of each TOC chapter, in reading order, for slider ticks
   *  and the scrub tooltip. Computed once per loaded book from the engine's
   *  positions; chapters absent from the TOC get no tick. */
  const chapterMarks = useMemo(() => {
    if (!doc || status !== "ready") return [];
    const raw = engineRef.current?.chapterMarks() ?? [];
    const out: { percent: number; title: string }[] = [];
    for (const mark of raw) {
      const chapter = doc.meta.chapters.find((c) => hrefMatches(c.href, mark.href));
      if (!chapter) continue;
      // Adjacent TOC entries can share a spine href — keep the first title.
      if (out.length > 0 && Math.abs(out[out.length - 1].percent - mark.percent) < 0.05) continue;
      out.push({ percent: mark.percent, title: chapter.title });
    }
    return out;
  }, [doc, status, engineRef]);

  /** "≈ N min left in chapter": the pace applied to the remainder of the
   *  current chapter (from its start mark to the next one). */
  const chapterTimeLeft = useMemo(() => {
    if (finished || !locator) return null;
    void paceVersion;
    const pace = paceRef.current;
    if (!pace) return null;
    // Index of the chapter the position is in: last mark ≤ percent.
    let index = -1;
    for (let i = 0; i < chapterMarks.length; i++) {
      if (chapterMarks[i].percent <= percent + 0.05) index = i;
      else break;
    }
    if (index === -1) return null;
    const start = chapterMarks[index].percent;
    const end = index + 1 < chapterMarks.length ? chapterMarks[index + 1].percent : 100;
    if (end <= start) return null;
    return formatChapterTimeLeft(pace.minutesForFraction((end - percent) / 100));
  }, [paceVersion, percent, locator, chapterMarks, finished, paceRef]);
  const backLabel = backLabelFor(readerOrigin?.route);
  // Fixed-layout page position (PDF plan §7.1): the dock shows "page x of y"
  // instead of a percent-only readout, and the scrubber steps per page.
  // D2: documents that grant no copy permission disable Copy / Share-as-image
  // (reading itself is never blocked).
  const noCopy = !!capabilities?.noCopy;
  const locatorPage = locator?.page;
  const locatorPageCount = locator?.pageCount;
  const locatorPageLabel = locator?.pageLabel;
  const pageInfo = useMemo(
    () =>
      isPdf && locatorPage && locatorPageCount
        ? { page: locatorPage, pageCount: locatorPageCount, label: locatorPageLabel }
        : null,
    [isPdf, locatorPage, locatorPageCount, locatorPageLabel],
  );
  const dockStep = useMemo(
    () => (isPdf && locatorPageCount ? Math.max(0.1, 100 / locatorPageCount) : undefined),
    [isPdf, locatorPageCount],
  );
  const bookmarked = useMemo(
    () =>
      !!locator &&
      annotations.some((a) => a.kind === "bookmark" && sameLocation(a.location, locator.location)),
    [annotations, locator],
  );

  /** Colour of the highlight the current selection overlaps, if any (R5). */
  const activeHighlightColor = useMemo(() => {
    if (!selection) return null;
    return (
      findOverlappingHighlight(annotations, selection.location, {
        quote: selection.quote,
        prefix: selection.prefix,
        suffix: selection.suffix,
      })?.color ?? null
    );
  }, [selection, annotations]);

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

      {isPdf && pdfPrefs?.thumbnails && pageInfo && (
        <PdfThumbnailStrip
          open={chrome.panel !== "appearance"}
          page={pageInfo.page}
          pageCount={pageInfo.pageCount}
          onSelect={handleGoPage}
          renderThumbnail={handleRenderThumbnail}
        />
      )}

      <div
        className="folio-reader__scrim"
        style={{ opacity: scrimAlpha(activePrefs.brightness) }}
        aria-hidden="true"
      />

      {/* F9 5.2c: line-focus reading band (EPUB only). Decorative overlay —
          the whole page remains interactive; it just dims around the band. */}
      {lineFocusOpen && !isPdf && (
        <div className="folio-linefocus" aria-hidden="true">
          <div className="folio-linefocus__band" />
        </div>
      )}

      {doc && (
        <>
          <ReaderChrome
            visible={chromeVisible && splashPhase === "done" && !chrome.isFocusMode}
            backLabel={backLabel}
            title={title}
            chapterTitle={chapterTitle}
            percent={percent}
            timeLeft={timeLeft}
            chapterTimeLeft={chapterTimeLeft}
            chapterMarks={chapterMarks}
            finished={finished}
            scrubValue={chrome.scrubValue}
            seeking={seeking}
            bookmarked={bookmarked}
            menuOpen={chrome.menuOpen}
            onMenuChange={chrome.setMenu}
            onBack={() => void handleBack()}
            onAppearance={() => chrome.openPanel("appearance")}
            onContents={() => chrome.openPanel("toc")}
            onSearch={() => search.toggle()}
            onBookmark={() => void handleBookmarkToggle().then(announceBookmark)}
            onShareQuote={() => setQuoteCardOpen(true)}
            shareEnabled={!!quoteSelection && !noCopy}
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
            pageInfo={pageInfo}
            step={dockStep}
          />

          <InBookSearchPanel
            open={isSearchOpen}
            query={search.query}
            results={search.results}
            activeIndex={search.activeIndex}
            isSearching={search.searching}
            searchError={search.error}
            onQueryChange={search.setQuery}
            onClear={search.clear}
            onClose={search.close}
            onSelectResult={(_, index) => search.select(index)}
            onNext={() => search.move(1)}
            onPrev={() => search.move(-1)}
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

          {footnote && <FootnotePopover activation={footnote} onClose={() => setFootnote(null)} />}

          {decorPopover && (
            <DecorationPopover
              x={decorPopover.x}
              y={decorPopover.y}
              hasNote={(annotations.find((a) => a.id === decorPopover.id)?.note ?? null) !== null}
              onClose={() => setDecorPopover(null)}
              onEditNote={() => editDecorationNote(decorPopover.id)}
              onRemove={() => void removeDecoration(decorPopover.id)}
            />
          )}

          {isPdf && pdfPrefs ? (
            <PdfAppearancePanel
              open={chrome.panel === "appearance"}
              modal={false}
              prefs={pdfPrefs}
              zoom={pdfZoom}
              pageInfo={pageInfo}
              onClose={chrome.closePanel}
              onChange={handlePdfPrefsChange}
              onReset={() => void handlePdfReset()}
              onZoomBy={(direction) => void handleZoomBy(direction)}
              onZoomMode={(mode) => void handleZoomMode(mode)}
              onZoomActual={() => void handleZoomActual()}
              onGoPage={handleGoPage}
            />
          ) : (
            <EpubAppearancePanel
              open={chrome.panel === "appearance"}
              modal={false}
              prefs={activePrefs}
              onClose={chrome.closePanel}
              onChange={handlePrefsChange}
              onReset={() => void handleReset()}
              capabilities={capabilities ?? undefined}
              zoom={pdfZoom}
              onZoomBy={(direction) => void handleZoomBy(direction)}
              onZoomMode={(mode) => void handleZoomMode(mode)}
              systemDark={systemDark}
              respectPublisherColors={epubPrefs?.respectPublisherColors ?? false}
              onPublisherColorsChange={handlePublisherColorsChange}
            />
          )}

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

          <FolioDialog
            open={endCardOpen}
            onClose={() => setEndCardOpen(false)}
            title="You've finished this book"
            actions={
              <>
                <FolioButton
                  variant="secondary"
                  onClick={() => {
                    setEndCardOpen(false);
                    const nav = navRef.current;
                    if (nav) {
                      reportNavigation(nav.goToPercent(0, "button"), "Couldn't jump to the start.");
                    }
                  }}
                >
                  Back to start
                </FolioButton>
                <FolioButton onClick={() => setEndCardOpen(false)}>Done</FolioButton>
              </>
            }
          >
            <div className="folio-end-card">
              <div className="folio-end-card__title">{title}</div>
              {doc?.author && <div className="folio-end-card__author">{doc.author}</div>}
              <p className="folio-end-card__text">
                That was the last page. Your highlights and notes stay with the book.
              </p>
            </div>
          </FolioDialog>

          {selection && (
            <SelectionToolbar
              rect={selection.rect}
              activeColor={activeHighlightColor}
              onHighlight={(color) => void toggleHighlight(color, selection)}
              onNote={() => openNoteEditor(selection)}
              onCopy={() => void handleCopySelection(selection.quote)}
              onCopyCitation={() => void handleCopyCitation(selection)}
              onShare={() => setQuoteCardOpen(true)}
              copyDisabled={noCopy}
            />
          )}

          {highlightPop && (
            <AnnotationPopover
              annotation={highlightPop.annotation}
              x={highlightPop.x}
              y={highlightPop.y}
              onClose={() => setHighlightPop(null)}
              onChangeColor={(color) => {
                const { annotation } = highlightPop;
                void updateAnnotation(annotation.id, { color: color as Annotation["color"] });
                setHighlightPop({
                  ...highlightPop,
                  annotation: { ...annotation, color: color as Annotation["color"] },
                });
              }}
              onEditNote={() => {
                setHighlightPop(null);
                setEditingAnnotation(highlightPop.annotation);
                setNoteDraft(highlightPop.annotation.note ?? "");
                setNoteEditorOpen(true);
              }}
              onDelete={() => {
                const { annotation } = highlightPop;
                setHighlightPop(null);
                void deleteAnnotation(annotation);
              }}
              onCopy={() => void handleCopySelection(highlightPop.annotation.quote)}
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

      <ReaderSplash
        phase={splashPhase}
        title={title}
        author={doc?.author ?? null}
        coverUrl={doc?.coverUrl ?? null}
        tint={tint}
        progress={splashProgress}
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
