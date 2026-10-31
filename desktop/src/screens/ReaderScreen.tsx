import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppearancePanel } from "../components/AppearancePanel";
import { ReaderChrome } from "../components/ReaderChrome";
import { ReaderSplash, type SplashPhase } from "../components/ReaderSplash";
import { TocPanel } from "../components/TocPanel";
import { SelectionToolbar } from "../components/SelectionToolbar";
import { QuoteCard } from "../components/QuoteCard";
import { FolioDialog } from "../components/FolioDialog";
import { FolioButton } from "../components/FolioButton";
import { tintIndexFromHash } from "../import/cover";
import type { TextSelectionInfo } from "../reader/ReaderEngine";
import { useReaderStore } from "../store/readerStore";
import { useRouteStore } from "../store/routeStore";
import { getLibraryFs, getLibraryManager } from "../store/libraryUi";
import { DEFAULT_READING_PREFS } from "../model/defaults";
import type { ReadingPrefs, Annotation } from "../model/types";
import { nowIso } from "../model/ids";
import { createReadiumEngine } from "../reader/readiumEngine";
import type {
  ReaderEngine,
  ReaderLocator,
  ReaderOpenTarget,
  TocEntry,
} from "../reader/ReaderEngine";
import { ChromeStateMachine, CHROME_IDLE_MS, intentForReaderClick } from "../reader/chrome";
import { createNavigationCoordinator, type ReaderNavigationCoordinator } from "../reader/navigation";
import { ProgressWriter } from "../reader/progress";
import { ReadingPaceStats, formatTimeLeft } from "../reader/pace";
import { resumePlan, type ResumePlan } from "../reader/resume";
import { hrefOf, sameLocation, withAnchor } from "../reader/locatorCodec";
import type { DecorationSpec } from "../reader/ReaderEngine";
import {
  KeepAwakeController,
  isTauri,
  readPreventSleepSetting,
} from "../reader/keepAwake";
import { resolveReaderTheme, scrimAlpha } from "../reader/readerThemes";

const SPLASH_FADE_MS = 300;
const SPLASH_FAILSAFE_MS = 8000;

/** Outcome of a bookmark toggle, surfaced as a user-facing notice (07 §2). */
type BookmarkResult = "added" | "removed" | "failed";

function planTarget(plan: ResumePlan): ReaderOpenTarget | null {
  switch (plan.kind) {
    case "override-locator":
      return { location: plan.locator };
    case "override-percent":
      return { percent: plan.percent };
    // The toolkit's `go()` accepts CFIs only through a parsed locator; our
    // byte-backed publication keeps the percent fallback (04 §8 step 2b).
    case "cfi":
      return { percent: plan.fallbackPercent };
    case "saved-locator":
      return { location: plan.locator };
    case "percent":
      return { percent: plan.percent };
    case "first":
      return null;
  }
}

function openExternal(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  void (async () => {
    try {
      if (isTauri()) await invoke("open_external_url", { url: href });
      else window.open(href, "_blank", "noopener,noreferrer");
    } catch {
      /* no browser hook in tests/browser-dev — ignore */
    }
  })();
  return true;
}

function hrefMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  // Stored locations carry progression/anchor query parameters; compare hrefs.
  const x = hrefOf(a) ?? a;
  const y = hrefOf(b) ?? b;
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

const HIGHLIGHT_CSS: Record<string, string> = {
  yellow: "#FFF3B0",
  green: "#CDE8C2",
  blue: "#BFDFF7",
  pink: "#F8CFE0",
};

/**
 * Highlights carry the text quote as their anchor so the range survives
 * repagination and a new edition's CSS. Annotations written by mobile have the
 * quote in separate fields rather than in `location`, so merge them here.
 */
function decorationsFor(annotations: Annotation[]): DecorationSpec[] {
  return annotations
    .filter((a) => a.kind === "highlight" && a.location)
    .map((a) => ({
      id: a.id,
      locator: withAnchor(
        a.location as string,
        a.quote.trim()
          ? { quote: a.quote, prefix: a.prefix, suffix: a.suffix }
          : null
      ),
      style: "highlight",
      color: HIGHLIGHT_CSS[a.color ?? "yellow"] ?? HIGHLIGHT_CSS.yellow,
    }));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // Focused controls (toolbar buttons, TOC entries, the scrubber, selects)
  // own their keys: keyboard page-turn shortcuts must not fight them (07 §2).
  return Boolean(
    target.closest(
      "input, textarea, select, button, a, [contenteditable='true'], [role='textbox'], [role='button'], [role='menuitem']"
    )
  );
}

/** Reader route (04): splash → Readium canvas → themed chrome + panels. */
export function ReaderScreen() {
  const request = useRouteStore((s) => s.readerRequest);
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
  const engineRef = useRef<ReaderEngine | null>(null);
  const navRef = useRef<ReaderNavigationCoordinator | null>(null);
  const writerRef = useRef<ProgressWriter | null>(null);
  const paceRef = useRef<ReadingPaceStats | null>(null);
  const keepAwakeRef = useRef<KeepAwakeController | null>(null);
  const chromeRef = useRef<ChromeStateMachine | null>(null);
  if (!chromeRef.current) chromeRef.current = new ChromeStateMachine();
  const prefsRef = useRef<ReadingPrefs>(DEFAULT_READING_PREFS);
  const savedPrefsRef = useRef("");
  const seekingRef = useRef(false);
  const disposedRef = useRef(false);
  const previousPercentRef = useRef<number | null>(null);
  const bookmarkToggleRef = useRef<() => Promise<BookmarkResult>>(async () => "failed");

  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_READING_PREFS);
  const [splash, setSplash] = useState<SplashPhase>("loading");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [locator, setLocator] = useState<ReaderLocator | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const [panel, setPanel] = useState<"appearance" | "toc" | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [inbookSearchOpen, setInbookSearchOpen] = useState(false);
  const [inbookQuery, setInbookQuery] = useState("");
  const [inbookResults, setInbookResults] = useState<
    { chapterTitle: string; snippetHtml: string; locator: string }[]
  >([]);
  const inbookTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inbookSearchSeqRef = useRef(0);
  const [selection, setSelection] = useState<TextSelectionInfo | null>(null);
  const [quoteSelection, setQuoteSelection] = useState<TextSelectionInfo | null>(null);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [quoteCardOpen, setQuoteCardOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [pendingSelection, setPendingSelection] = useState<TextSelectionInfo | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [navNotice, setNavNotice] = useState<string | null>(null);
  const navNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );

  const theme = resolveReaderTheme(prefs.theme, systemDark);
  const activePrefs = doc ? prefs : DEFAULT_READING_PREFS;

  // ---- load the schema-1 doc for the route request -------------------------
  useEffect(() => {
    if (request) void load(request);
  }, [request, load]);

  // ---- OS theme changes (theme === "system") -------------------------------
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // ---- adopt the doc's resolved prefs on (re)load --------------------------
  useEffect(() => {
    if (!doc) return;
    setPrefs(doc.prefs);
    prefsRef.current = doc.prefs;
    savedPrefsRef.current = JSON.stringify(doc.prefs);
    setSplash("loading");
    setEngineError(null);
    setLocator(null);
    setToc([]);
    setPanel(null);
    previousPercentRef.current = null;
  }, [doc?.docId, retryNonce]);

  useEffect(() => {
    if (!inbookSearchOpen) return;
    if (inbookTimerRef.current) clearTimeout(inbookTimerRef.current);
    // Request token: a slow older search must never replace the results of a
    // newer query (04 §6).
    const token = ++inbookSearchSeqRef.current;
    inbookTimerRef.current = setTimeout(async () => {
      const engine = engineRef.current;
      if (!engine || !inbookQuery.trim()) {
        setInbookResults([]);
        return;
      }
      try {
        const hits = await engine.search(inbookQuery);
        if (token === inbookSearchSeqRef.current) setInbookResults(hits);
      } catch {
        if (token === inbookSearchSeqRef.current) setInbookResults([]);
      }
    }, 250);
    return () => {
      if (inbookTimerRef.current) clearTimeout(inbookTimerRef.current);
    };
  }, [inbookQuery, inbookSearchOpen]);

  useEffect(() => {
    if (status === "error") {
      setEngineError(loadError);
      setSplash("error");
    }
  }, [status, loadError]);

  // Cross-fade after the first locator (300 ms, 03 §6).
  useEffect(() => {
    if (splash !== "fading") return;
    const timer = setTimeout(() => setSplash("done"), SPLASH_FADE_MS);
    return () => clearTimeout(timer);
  }, [splash]);

  // ---- engine lifecycle ----------------------------------------------------
  useEffect(() => {
    if (!doc) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    disposedRef.current = false;
    const plan = resumePlan(
      doc.progress ? { location: doc.progress.location, percent: doc.progress.percent } : null,
      request
        ? { location: request.location, percent: request.percent, anchor: request.anchor }
        : null
    );
    const target = planTarget(plan);
    const restorePending = plan.kind !== "first";

    const engine = createReadiumEngine({
      epubBytes: doc.epubBytes,
      prefs: prefsRef.current,
      initial: target,
    });
    engineRef.current = engine;

    // Every navigation goes through one coordinator: page clicks, keyboard,
    // scrubbing, TOC, search. It never recreates the navigator — it gates the
    // seek state, sequences overlapping requests and returns success/failure.
    const nav = createNavigationCoordinator(engine, {
      onBeforeMove: () => pace.breakSession(Date.now()),
      onSeekingChanged: (seeking) => {
        seekingRef.current = seeking;
      },
    });
    navRef.current = nav;

    const pace = new ReadingPaceStats(doc.progress?.pace ?? null);
    paceRef.current = pace;
    const writer = new ProgressWriter(async (snapshot) => {
      await persistProgress({
        location: snapshot.location,
        percent: snapshot.percent,
        pace: snapshot.pace ?? pace.state(),
      });
    });
    writerRef.current = writer;

    let firstLocatorSeen = false;
    let cancelled = false;

    const failsafe = setTimeout(() => {
      if (cancelled || firstLocatorSeen) return;
      setEngineError("This book is taking longer than expected to open.");
      setSplash("error");
    }, SPLASH_FAILSAFE_MS);

    const offLocator = engine.onLocator((next) => {
      firstLocatorSeen = true;
      clearTimeout(failsafe);
      keepAwakeRef.current?.markActivity();
      setLocator(next);
      setSplash((phase) => (phase === "loading" ? "fading" : phase));

      const percent = (next.progression ?? 0) * 100;
      const now = Date.now();
      if (seekingRef.current) {
        pace.breakSession(now);
      } else if (
        previousPercentRef.current !== null &&
        Math.abs(percent - previousPercentRef.current) > 0.01
      ) {
        // Jumps/back-steps re-anchor without credit; continuous forward turns
        // accrue wall-clock time (04 §9).
        pace.onForwardMove(percent, now);
      }
      previousPercentRef.current = percent;

      const snapshot = {
        location: next.location,
        percent,
        pace: pace.state(),
      };
      if (restorePending && !writer.hasWritten) {
        void writer.writeRestored(snapshot);
      } else if (seekingRef.current) {
        void writer.onScrub(snapshot);
      } else {
        void writer.onLocator(snapshot);
      }
    });

    const offClick = engine.onClick((info) => {
      const chrome = chromeRef.current!;
      chrome.onActivity();
      setChromeVisible(true);
      const intent = intentForReaderClick({
        x: info.x,
        width: info.width || canvas.clientWidth || 1,
        interactive: info.interactive,
        defaultPrevented: info.defaultPrevented,
      });
      // Interactive elements (links, footnotes, media) must reach the engine's
      // own handling — turning a tap on a link into a page flip is a trust bug.
      if (intent === "passthrough") return false;
      if (intent === "toggle") {
        chrome.toggle();
        setChromeVisible(chrome.visible);
        return true;
      }
      // Coordinator's onBeforeMove breaks the pace session.
      if (intent === "forward") void nav.next();
      else void nav.previous();
      return true;
    });

    const offSelection = engine.onSelection((sel) => {
      setSelection(sel);
      if (sel) {
        setQuoteSelection(sel);
        paceRef.current?.breakSession(Date.now());
      }
    });

    const offLink = engine.onLink((href) => openExternal(href));

    void (async () => {
      try {
        await engine.open(canvas);
        if (cancelled) return;
        setToc(engine.toc());
        // Paint existing highlights (04 §7).
        try {
          const lm = getLibraryManager();
          const anns = await lm.annotations.listForDoc(doc.docId);
          await engine.applyDecorations(decorationsFor(anns));
        } catch {
          /* annotation load failure must not break reading */
        }
      } catch (error) {
        if (cancelled) return;
        clearTimeout(failsafe);
        setEngineError(error instanceof Error ? error.message : "This book can't be opened");
        setSplash("error");
      }
    })();

    return () => {
      // The engine is idempotent to double-destroy (destroy() nulls the
      // navigator), and handleBack may have flushed already. Always discard
      // the subscriptions and mutate refs, or they leak across sessions.
      cancelled = true;
      clearTimeout(failsafe);
      offLocator();
      offClick();
      offSelection();
      offLink();
      void writer.flush();
      void engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
      if (navRef.current === nav) navRef.current = null;
      writerRef.current = null;
      paceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.docId, retryNonce, request]);

  // ---- chrome auto-hide + keep-awake polling ------------------------------
  useEffect(() => {
    if (!doc) return;
    const chromeTimer = setInterval(() => {
      const chrome = chromeRef.current;
      if (!chrome) return;
      // An open menu means an active interaction: do not hide the toolbar
      // underneath it (04 §5 menu lifecycle).
      if (menuOpenRef.current) {
        chrome.onActivity();
        return;
      }
      setChromeVisible(chrome.tick() === "visible");
    }, Math.min(250, CHROME_IDLE_MS / 4));
    return () => clearInterval(chromeTimer);
  }, [doc?.docId]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const controller = new KeepAwakeController();
    keepAwakeRef.current = controller;
    let enabled = true;

    void readPreventSleepSetting(getLibraryFs()).then((value) => {
      enabled = value;
      if (!value && !cancelled) void controller.release();
    });

    const timer = setInterval(() => {
      if (!cancelled && enabled) void controller.tick();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      void controller.release();
      if (keepAwakeRef.current === controller) keepAwakeRef.current = null;
    };
  }, [doc?.docId]);

  // ---- debounced per-book prefs writes ------------------------------------
  // `doc` churns on every progress persist; keying on docId keeps page turns
  // from relaying out the navigator via a redundant applyPrefs.
  useEffect(() => {
    if (!doc) return;
    prefsRef.current = prefs;
    void engineRef.current?.applyPrefs(prefs);
    const serialized = JSON.stringify(prefs);
    if (serialized === savedPrefsRef.current) return;
    const timer = setTimeout(() => {
      savedPrefsRef.current = serialized;
      void savePrefs(prefs);
    }, 400);
    return () => clearTimeout(timer);
  }, [prefs, doc?.docId, savePrefs]);

  // ---- keyboard matrix (07 §2) --------------------------------------------
  useEffect(() => {
    if (!doc) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isTypingTarget(event.target)) return;
      const engine = engineRef.current;
      if (!engine) return;

      const turn = (direction: "next" | "previous") => {
        void navRef.current?.[direction]();
      };
      const jump = (percent: number) => {
        void navRef.current?.goToPercent(percent);
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
        case "t":
        case "T":
          event.preventDefault();
          setPanel((current) => (current === "toc" ? null : "toc"));
          chromeRef.current?.onActivity();
          setChromeVisible(true);
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
            setInbookSearchOpen((open) => !open);
            chromeRef.current?.onActivity();
            setChromeVisible(true);
          }
          break;
        case "Escape":
          // Close the topmost interaction only (07 §2): More menu → panel →
          // search → selection. The menu lives in controlled state, so it is
          // first here; focus returns to the control that opened it.
          if (menuOpenRef.current) {
            setMenu(false);
            document.getElementById("folio-reader-more")?.focus();
          } else if (panel) setPanel(null);
          else if (inbookSearchOpen) setInbookSearchOpen(false);
          else if (selection) setSelection(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, panel, inbookSearchOpen, selection]);

  // Best-effort flush if the window is closed from the OS (07 §5).
  useEffect(() => {
    if (!doc) return;
    const flush = () => {
      void writerRef.current?.flush();
      void keepAwakeRef.current?.release();
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [doc?.docId]);

  useEffect(() => {
    return () => {
      if (navNoticeTimerRef.current) clearTimeout(navNoticeTimerRef.current);
    };
  }, []);

  const handleBack = useCallback(async () => {
    // Effect teardown destroys the engine; only flush and navigate here.
    // disposedRef keeps a double-back from closing twice.
    if (disposedRef.current) return;
    disposedRef.current = true;
    await writerRef.current?.flush();
    await keepAwakeRef.current?.release();
    closeDoc();
    closeReader();
  }, [closeDoc, closeReader]);

  const handleRetry = useCallback(() => {
    setEngineError(null);
    setLocator(null);
    setSplash("loading");
    previousPercentRef.current = null;
    setRetryNonce((n) => n + 1);
    if (request && status === "error") void load(request);
  }, [load, request, status]);

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

  const resolveChapterId = useCallback(
    (location: string | null | undefined): string | null => {
      if (!doc || !location) return null;
      const href = hrefOf(location);
      if (!href) return null;
      const chapter = doc.meta.chapters.find((c) => hrefMatches(c.href, href));
      return chapter?.id ?? null;
    },
    [doc]
  );

  const createAnnotation = useCallback(
    async (
      sel: TextSelectionInfo,
      kind: Annotation["kind"],
      color: Annotation["color"] = null,
      note: string | null = null
    ) => {
      if (!doc) return;
      const lm = getLibraryManager();
      const prefix = sel.prefix.slice(0, 32);
      const suffix = sel.suffix.slice(0, 32);
      const annotation: Annotation = {
        id: crypto.randomUUID(),
        docId: doc.docId,
        chapterId: resolveChapterId(sel.location),
        quote: sel.quote,
        prefix,
        suffix,
        // Store the quote as the locator's text anchor so the highlight can be
        // re-found after repagination (mobile stores a CFI here instead).
        location: sel.location
          ? withAnchor(sel.location, { quote: sel.quote, prefix, suffix })
          : null,
        kind,
        color,
        note,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await lm.annotations.add(annotation);
      // Re-paint highlights.
      if (kind === "highlight") {
        try {
          const anns = await lm.annotations.listForDoc(doc.docId);
          await engineRef.current?.applyDecorations(decorationsFor(anns));
        } catch {
          /* ignore */
        }
      }
    },
    [doc, resolveChapterId]
  );

  const toggleHighlight = useCallback(
    async (color: string, sel: TextSelectionInfo) => {
      if (!doc) return;
      const lm = getLibraryManager();
      const existing = (await lm.annotations.listForDoc(doc.docId)).find(
        (a) => a.kind === "highlight" && a.quote === sel.quote && a.color === color
      );
      if (existing) {
        await lm.annotations.remove(existing.id);
      } else {
        await createAnnotation(sel, "highlight", color as Annotation["color"], null);
      }
      // Re-paint.
      try {
        const anns = await lm.annotations.listForDoc(doc.docId);
        await engineRef.current?.applyDecorations(decorationsFor(anns));
      } catch {
        /* ignore */
      }
      setSelection(null);
    },
    [doc, createAnnotation]
  );

  const handleCopySelection = useCallback(async (quote: string) => {    try {
      await navigator.clipboard.writeText(quote);
    } catch {
      /* ignore */
    }
    setSelection(null);
  }, []);

  const openNoteEditor = useCallback((sel: TextSelectionInfo) => {
    setPendingSelection(sel);
    setNoteDraft("");
    setNoteEditorOpen(true);
    setSelection(null);
  }, []);

  const saveNote = useCallback(async () => {
    if (!pendingSelection) return;
    await createAnnotation(pendingSelection, "note", "yellow", noteDraft.trim() || null);
    setNoteEditorOpen(false);
    setPendingSelection(null);
    setNoteDraft("");
  }, [pendingSelection, noteDraft, createAnnotation]);

  const handleBookmarkToggle = useCallback(async (): Promise<BookmarkResult> => {
    if (!doc) return "failed";
    const loc = engineRef.current?.currentLocator();
    if (!loc) return "failed";
    try {
      const lm = getLibraryManager();
      // Compare by href + progression, not string equality: the engine reports
      // slightly different progressions for the same page as layout settles.
      const existing = (await lm.annotations.listForDoc(doc.docId)).find(
        (a) => a.kind === "bookmark" && sameLocation(a.location, loc.location)
      );
      if (existing) {
        await lm.annotations.remove(existing.id);
        return "removed";
      }
      const annotation: Annotation = {
        id: crypto.randomUUID(),
        docId: doc.docId,
        chapterId: resolveChapterId(loc.location),
        quote: "",
        prefix: "",
        suffix: "",
        location: loc.location || null,
        kind: "bookmark",
        color: null,
        note: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await lm.annotations.add(annotation);
      return "added";
    } catch {
      // A failed write must not look like success; the notice surfaces it.
      return "failed";
    }
  }, [doc, resolveChapterId]);

  useEffect(() => {
    bookmarkToggleRef.current = handleBookmarkToggle;
  }, [handleBookmarkToggle]);

  const openPanel = useCallback((next: "appearance" | "toc") => {
    paceRef.current?.breakSession(Date.now());
    chromeRef.current?.onActivity();
    setChromeVisible(true);
    setPanel(next);
  }, []);

  const goToHref = useCallback(
    async (href: string): Promise<boolean> => {
      const nav = navRef.current;
      if (!nav) return false;
      return nav.goToHref(href);
    },
    []
  );

  /** Unresolved TOC / search / scrub jumps surface here instead of vanishing. */
  const showNavNotice = useCallback((message: string) => {
    if (navNoticeTimerRef.current) clearTimeout(navNoticeTimerRef.current);
    setNavNotice(message);
    navNoticeTimerRef.current = setTimeout(() => setNavNotice(null), 4000);
  }, []);

  /** The More menu is controlled here so keyboard (07 §2) and the auto-hide
   * tick honour it; the component-owned state in ReaderChrome could not. */
  const setMenu = useCallback((open: boolean) => {
    menuOpenRef.current = open;
    setMenuOpen(open);
  }, []);

  const announceBookmark = useCallback((result: BookmarkResult) => {
    if (result === "added") showNavNotice("Bookmark added.");
    else if (result === "removed") showNavNotice("Bookmark removed.");
    else if (result === "failed") showNavNotice("Couldn't update the bookmark.");
  }, [showNavNotice]);

  const handleScrubStart = useCallback(() => {
    chromeRef.current?.onScrubStart();
    paceRef.current?.breakSession(Date.now());
    previousPercentRef.current = null;
    const current = (locator?.progression ?? (doc?.progress?.percent ?? 0) / 100) * 100;
    setScrubValue(current);
  }, [doc?.progress?.percent, locator?.progression]);

  const handleScrubChange = useCallback((percent: number) => {
    setScrubValue(percent);
    chromeRef.current?.onActivity();
  }, []);

  const handleScrubEnd = useCallback(
    (percent: number) => {
      chromeRef.current?.onScrubEnd();
      setScrubValue(null);
      const nav = navRef.current;
      if (!nav) return;
      void nav.goToPercent(percent).then((ok) => {
        if (!ok) showNavNotice("Couldn't jump to that position.");
      });
    },
    [showNavNotice]
  );

  const onMouseMove = useCallback(() => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    chrome.onActivity();
    setChromeVisible((visible) => (visible ? visible : true));
  }, []);

  const title = doc?.title ?? (request ? "Opening book…" : "Reader");
  const chapterTitle =
    locator?.chapterTitle ??
    doc?.meta.chapters.find((c) => hrefMatches(c.href, locator?.chapterHref))?.title ??
    title;
  const percent =
    scrubValue ??
    (locator?.progression !== undefined
      ? locator.progression * 100
      : (doc?.progress?.percent ?? 0));
  const timeLeft = formatTimeLeft(paceRef.current?.timeLeftMinutes(percent) ?? null);

  const tint = doc?.meta.contentHash ? tintIndexFromHash(doc.meta.contentHash) : 0;
  const splashPhase: SplashPhase =
    status === "error" || splash === "error" ? "error" : splash;

  return (
    <div
      className="folio-reader"
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
      onMouseMove={onMouseMove}
    >
      <div ref={canvasRef} className="folio-reader__canvas" />

      <div
        className="folio-reader__scrim"
        style={{ opacity: scrimAlpha(activePrefs.brightness) }}
        aria-hidden="true"
      />

      {doc && (
        <>
          <ReaderChrome
            visible={chromeVisible && splashPhase === "done"}
            title={title}
            chapterTitle={chapterTitle}
            percent={percent}
            timeLeft={timeLeft}
            scrubValue={scrubValue}
            menuOpen={menuOpen}
            onMenuChange={setMenu}
            onBack={() => void handleBack()}
            onAppearance={() => openPanel("appearance")}
            onToc={() => openPanel("toc")}
            onSearch={() => setInbookSearchOpen((v) => !v)}
            onBookmark={() => void handleBookmarkToggle().then(announceBookmark)}
            onShareQuote={() => setQuoteCardOpen(true)}
            shareEnabled={!!quoteSelection}
            onScrubStart={handleScrubStart}
            onScrubChange={handleScrubChange}
            onScrubEnd={handleScrubEnd}
          />

          {inbookSearchOpen && (
            <div className="folio-inbook-search">
              <input
                type="search"
                className="folio-inbook-search__input"
                placeholder="Search in book…"
                value={inbookQuery}
                onChange={(e) => setInbookQuery(e.target.value)}
                autoFocus
              />
              {inbookResults.length > 0 && (
                <div className="folio-inbook-search__results">
                  {inbookResults.map((r, i) => (
                    <button
                      key={`${r.locator}-${i}`}
                      type="button"
                      className="folio-inbook-search__result"
                      onClick={() => {
                        setInbookSearchOpen(false);
                        void goToHref(r.locator).then((ok) => {
                          if (!ok) showNavNotice("Couldn't reach that search result.");
                        });
                      }}
                    >
                      <div className="folio-inbook-search__chapter">{r.chapterTitle}</div>
                      <div
                        className="folio-inbook-search__snippet"
                        dangerouslySetInnerHTML={{ __html: r.snippetHtml }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <AppearancePanel
            open={panel === "appearance"}
            prefs={activePrefs}
            onClose={() => setPanel(null)}
            onChange={handlePrefsChange}
            onReset={() => void handleReset()}
          />

          <TocPanel
            open={panel === "toc"}
            entries={toc}
            currentHref={locator?.chapterHref}
            onClose={() => setPanel(null)}
            onSelect={(href) => {
              setPanel(null);
              void goToHref(href).then((ok) => {
                if (!ok) showNavNotice("Couldn't reach that section.");
              });
            }}
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
              setPendingSelection(null);
            }}
            title="Add note"
            actions={
              <>
                <FolioButton
                  variant="secondary"
                  onClick={() => {
                    setNoteEditorOpen(false);
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
            {pendingSelection && (
              <blockquote className="folio-note-quote">{pendingSelection.quote}</blockquote>
            )}
            <textarea
              className="folio-note-input"
              rows={4}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Add a note (optional)…"
              autoFocus
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
