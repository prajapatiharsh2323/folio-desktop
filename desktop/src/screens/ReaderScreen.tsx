import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppearancePanel } from "../components/AppearancePanel";
import { ReaderChrome } from "../components/ReaderChrome";
import { ReaderContextMenu } from "../components/ReaderContextMenu";
import { ReaderSplash, type SplashPhase } from "../components/ReaderSplash";
import { TocPanel, type WorkspaceTab } from "../components/TocPanel";
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
import {
  ChromeStateMachine,
  CHROME_IDLE_MS,
  intentForReaderClick,
  type ChromeHold,
} from "../reader/chrome";
import {
  createNavigationCoordinator,
  type NavigationOrigin,
  type NavigationOutcome,
  type ReaderNavigationCoordinator,
} from "../reader/navigation";
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
/** Bottom hover band that reveals the dock (07 §2). */
const DOCK_REVEAL_ZONE_PX = 56;

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

/**
 * Text entry and sliders own their keys — typing a query or nudging the
 * scrubber must never turn the page (07 §2). Chrome buttons deliberately do
 * NOT own the arrow keys: page turns keep working while a toolbar control has
 * focus, which is what a permanent dock makes obvious.
 */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='slider'], [role='spinbutton'], [role='dialog']"
    )
  );
}

/** Space/Enter belong to a focused control; arrows still page-turn. */
function isActivatableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("button, a[href], [role='button'], [role='menuitem'], [role='switch'], [role='radio']")
  );
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
  /** Mirror of scrubValue: the dock can release twice (keyup + blur). */
  const scrubValueRef = useRef<number | null>(null);
  /** A live selection owns the pointer — edge clicks must not turn the page. */
  const selectionRef = useRef<TextSelectionInfo | null>(null);
  const lastPacePublishRef = useRef(0);
  const sessionStartTsRef = useRef(Date.now());

  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_READING_PREFS);
  const [splash, setSplash] = useState<SplashPhase>("loading");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [locator, setLocator] = useState<ReaderLocator | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const [panel, setPanel] = useState<"appearance" | "toc" | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("contents");
  const [toc, setToc] = useState<TocEntry[]>([]);

  // Search state
  const [inbookSearchOpen, setInbookSearchOpen] = useState(false);
  const [inbookQuery, setInbookQuery] = useState("");
  const [inbookSearching, setInbookSearching] = useState(false);
  const [inbookError, setInbookError] = useState<string | null>(null);
  const [inbookResults, setInbookResults] = useState<
    { chapterTitle: string; snippetHtml: string; locator: string }[]
  >([]);
  const inbookTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inbookSearchSeqRef = useRef(0);

  // Dialogs & Focus Mode
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false);
  const [shortcutsGuideOpen, setShortcutsGuideOpen] = useState(false);

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
  const [retryNonce, setRetryNonce] = useState(0);
  const [navNotice, setNavNotice] = useState<string | null>(null);
  const navNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [seeking, setSeeking] = useState(false);
  /** Bumped at most once a second so pace-derived labels stay live without
   *  re-rendering on every scroll locator. */
  const [paceVersion, setPaceVersion] = useState(0);
  /** This book's annotations — the source for bookmark state and the workspace panel. */
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
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
    [showNavNotice]
  );

  const paintAnnotations = useCallback(async (list: Annotation[]) => {
    setAnnotations(list);
    try {
      await engineRef.current?.applyDecorations(decorationsFor(list));
    } catch {
      /* a paint failure must not break reading */
    }
  }, []);

  const refreshAnnotations = useCallback(
    async (docId?: string): Promise<Annotation[]> => {
      const id = docId ?? useReaderStore.getState().doc?.docId;
      if (!id) return [];
      const list = await getLibraryManager().annotations.listForDoc(id);
      await paintAnnotations(list);
      return list;
    },
    [paintAnnotations]
  );

  /** Focus/pointer holds keep the chrome up while the user works in it. */
  const handleChromeHold = useCallback((reason: "focus" | "pointer", active: boolean) => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    if (active) chrome.hold(reason);
    else chrome.release(reason);
    setChromeVisible(chrome.visible);
  }, []);

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
    setCtxMenu(null);
    setAnnotations([]);
    setIsFocusMode(false);
    setSessionInfoOpen(false);
    setShortcutsGuideOpen(false);
    setEditingAnnotation(null);
    sessionStartTsRef.current = Date.now();
    previousPercentRef.current = null;
  }, [doc?.docId, retryNonce]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // Debounced in-book text search
  useEffect(() => {
    if (!inbookSearchOpen) return;
    if (inbookTimerRef.current) clearTimeout(inbookTimerRef.current);
    if (!inbookQuery.trim()) {
      setInbookResults([]);
      setInbookSearching(false);
      setInbookError(null);
      return;
    }
    setInbookSearching(true);
    setInbookError(null);
    const token = ++inbookSearchSeqRef.current;
    inbookTimerRef.current = setTimeout(async () => {
      const engine = engineRef.current;
      if (!engine || !inbookQuery.trim()) {
        setInbookResults([]);
        setInbookSearching(false);
        return;
      }
      try {
        const hits = await engine.search(inbookQuery);
        if (token === inbookSearchSeqRef.current) {
          setInbookResults(hits);
          setInbookSearching(false);
        }
      } catch {
        if (token === inbookSearchSeqRef.current) {
          setInbookResults([]);
          setInbookSearching(false);
          setInbookError("Search failed to complete.");
        }
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
    // scrubbing, TOC, search. It gates seek state, sequences overlapping requests
    // and returns success/failure outcomes.
    const nav = createNavigationCoordinator(engine, {
      onBeforeMove: () => pace.breakSession(Date.now()),
      onSeekingChanged: (seekingNow) => {
        seekingRef.current = seekingNow;
        setSeeking(seekingNow);
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
        pace.onForwardMove(percent, now);
      }
      previousPercentRef.current = percent;

      if (now - lastPacePublishRef.current >= 1000) {
        lastPacePublishRef.current = now;
        setPaceVersion((v) => v + 1);
      }

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
      const intent = intentForReaderClick({
        x: info.x,
        width: info.width || canvas.clientWidth || 1,
        interactive: info.interactive,
        defaultPrevented: info.defaultPrevented,
      });
      if (intent === "passthrough") return false;
      if (selectionRef.current) return false;
      if (chrome.visible && !isFocusMode) chrome.onActivity();
      if (intent === "next") {
        reportNavigation(nav.next("page-edge"), "Couldn't turn the page forward.");
      } else {
        reportNavigation(nav.previous("page-edge"), "Couldn't turn the page back.");
      }
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
    const offPointer = engine.onPointerActivity(() => {
      const chrome = chromeRef.current;
      if (!chrome || isFocusMode) return;
      chrome.onActivity();
      setChromeVisible(chrome.visible);
    });
    const offCtxMenu = engine.onContextMenu((info) => {
      contextMenuRef.current(info.x, info.y);
      return true;
    });

    void (async () => {
      try {
        await engine.open(canvas);
        if (cancelled) return;
        setToc(engine.toc());
        try {
          await refreshAnnotations(doc.docId);
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
      cancelled = true;
      clearTimeout(failsafe);
      offLocator();
      offClick();
      offSelection();
      offLink();
      offPointer();
      offCtxMenu();
      void writer.flush();
      void engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
      if (navRef.current === nav) navRef.current = null;
      writerRef.current = null;
      paceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.docId, retryNonce, request]);

  // ---- chrome holds: menus, panels, dialogs, search, selection -------------
  useEffect(() => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    const sync = (reason: ChromeHold, active: boolean) => {
      if (active) chrome.hold(reason);
      else chrome.release(reason);
    };
    sync("menu", menuOpen || ctxMenu !== null);
    sync("panel", panel !== null);
    sync("dialog", noteEditorOpen || quoteCardOpen || sessionInfoOpen || shortcutsGuideOpen);
    sync("search", inbookSearchOpen);
    sync("selection", selection !== null);
    setChromeVisible(chrome.visible);
  }, [
    menuOpen,
    ctxMenu,
    panel,
    noteEditorOpen,
    quoteCardOpen,
    sessionInfoOpen,
    shortcutsGuideOpen,
    inbookSearchOpen,
    selection,
  ]);

  // ---- chrome auto-hide + keep-awake polling ------------------------------
  useEffect(() => {
    if (!doc) return;
    const chromeTimer = setInterval(() => {
      const chrome = chromeRef.current;
      if (!chrome) return;
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

  // ---- keyboard matrix ----------------------------------------------------
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
          direction === "next" ? "Couldn't turn the page forward." : "Couldn't turn the page back."
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
          setWorkspaceTab("contents");
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
          } else {
            // Unmodified 'f' toggles focus mode
            event.preventDefault();
            setIsFocusMode((f) => !f);
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
            setNoteEditorOpen(false);
            setEditingAnnotation(null);
            setPendingSelection(null);
          } else if (quoteCardOpen) {
            setQuoteCardOpen(false);
          } else if (ctxMenu) {
            setCtxMenu(null);
          } else if (panel) {
            setPanel(null);
          } else if (inbookSearchOpen) {
            setInbookSearchOpen(false);
          } else if (isFocusMode) {
            setIsFocusMode(false);
            showNavNotice("Exited focus mode.");
          } else if (selection) {
            setSelection(null);
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
    inbookSearchOpen,
    selection,
    ctxMenu,
    isFocusMode,
    shortcutsGuideOpen,
    sessionInfoOpen,
    noteEditorOpen,
    quoteCardOpen,
    reportNavigation,
    showNavNotice,
  ]);

  // Best-effort flush if window is closed
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
      try {
        await refreshAnnotations(doc.docId);
      } catch {
        /* a paint failure must not lose the annotation */
      }
    },
    [doc, resolveChapterId, refreshAnnotations]
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
        showNavNotice("Highlight removed.");
      } else {
        await createAnnotation(sel, "highlight", color as Annotation["color"], null);
        showNavNotice("Highlight added.");
        setSelection(null);
        return;
      }
      try {
        await refreshAnnotations(doc.docId);
      } catch {
        /* ignore */
      }
      setSelection(null);
    },
    [doc, createAnnotation, refreshAnnotations, showNavNotice]
  );

  const handleCopySelection = useCallback(async (quote: string) => {
    try {
      await navigator.clipboard.writeText(quote);
      showNavNotice("Copied to clipboard.");
    } catch {
      /* ignore */
    }
    setSelection(null);
  }, [showNavNotice]);

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
      await lm.annotations.update(editingAnnotation.id, {
        note: noteDraft.trim() || null,
        updatedAt: nowIso(),
      });
      if (doc) await refreshAnnotations(doc.docId);
      showNavNotice("Note updated.");
      setNoteEditorOpen(false);
      setEditingAnnotation(null);
      setNoteDraft("");
      return;
    }
    if (!pendingSelection) return;
    await createAnnotation(pendingSelection, "note", "yellow", noteDraft.trim() || null);
    showNavNotice("Note saved.");
    setNoteEditorOpen(false);
    setPendingSelection(null);
    setNoteDraft("");
  }, [editingAnnotation, pendingSelection, noteDraft, doc, refreshAnnotations, createAnnotation, showNavNotice]);

  const handleBookmarkToggle = useCallback(async (): Promise<BookmarkResult> => {
    if (!doc) return "failed";
    const loc = engineRef.current?.currentLocator();
    if (!loc) return "failed";
    const refreshBookmarks = async () => {
      try {
        await refreshAnnotations(doc.docId);
      } catch {
        /* bookmark state catches up on next refresh */
      }
    };
    try {
      const lm = getLibraryManager();
      const existing = (await lm.annotations.listForDoc(doc.docId)).find(
        (a) => a.kind === "bookmark" && sameLocation(a.location, loc.location)
      );
      if (existing) {
        await lm.annotations.remove(existing.id);
        await refreshBookmarks();
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
      await refreshBookmarks();
      return "added";
    } catch {
      return "failed";
    }
  }, [doc, resolveChapterId, refreshAnnotations]);

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
    []
  );

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
    scrubValueRef.current = current;
    setScrubValue(current);
  }, [doc?.progress?.percent, locator?.progression]);

  const handleScrubChange = useCallback((percent: number) => {
    scrubValueRef.current = percent;
    setScrubValue(percent);
    chromeRef.current?.onActivity();
  }, []);

  const handleScrubEnd = useCallback(
    (percent: number) => {
      chromeRef.current?.onScrubEnd();
      if (scrubValueRef.current === null) return;
      scrubValueRef.current = null;
      setScrubValue(null);
      const nav = navRef.current;
      if (!nav) return;
      reportNavigation(nav.goToPercent(percent, "slider"), "Couldn't jump to that position.");
    },
    [reportNavigation]
  );

  const handleTurn = useCallback(
    (direction: "next" | "previous") => {
      const nav = navRef.current;
      if (!nav) return;
      reportNavigation(
        nav[direction]("button"),
        direction === "next" ? "Couldn't turn the page forward." : "Couldn't turn the page back."
      );
    },
    [reportNavigation]
  );

  const handleToggleChrome = useCallback(() => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    chrome.release("menu");
    chrome.release("focus");
    chrome.toggle();
    setChromeVisible(chrome.visible);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isFocusMode) return;
    const chrome = chromeRef.current;
    if (!chrome) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.height > 0 && e.clientY >= rect.bottom - DOCK_REVEAL_ZONE_PX) {
      chrome.onPillarHover();
    } else {
      chrome.onActivity();
    }
    setChromeVisible((visible) => (visible ? visible : true));
  }, [isFocusMode]);

  const onReaderSurfaceClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isFocusMode) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        ".folio-reader-chrome, .folio-panel, .folio-overlay, .folio-reader-menu, .folio-reader-ctxmenu, .folio-inbook-search-panel, .folio-selection-toolbar, .folio-dialog, [role='dialog'], .folio-snackbar, .folio-reader-splash, .folio-reader-focus-exit"
      )
    ) {
      return;
    }
    chromeRef.current?.onActivity();
    setChromeVisible(true);
  }, [isFocusMode]);

  const onReaderContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        ".folio-reader-chrome, .folio-panel, .folio-overlay, .folio-reader-menu, .folio-reader-ctxmenu, .folio-inbook-search-panel, .folio-selection-toolbar, [role='dialog'], .folio-snackbar, .folio-reader-splash, .folio-reader-focus-exit"
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
    scrubValue ??
    (locator?.progression !== undefined
      ? locator.progression * 100
      : (doc?.progress?.percent ?? 0));
  const timeLeft = useMemo(
    () => formatTimeLeft(paceRef.current?.timeLeftMinutes(percent) ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paceVersion, percent]
  );
  const backLabel = backLabelFor(readerOrigin?.route);
  const bookmarked = useMemo(
    () =>
      !!locator &&
      annotations.some((a) => a.kind === "bookmark" && sameLocation(a.location, locator.location)),
    [annotations, locator]
  );

  const tint = doc?.meta.contentHash ? tintIndexFromHash(doc.meta.contentHash) : 0;
  const splashPhase: SplashPhase =
    status === "error" || splash === "error" ? "error" : splash;

  return (
    <div
      className={`folio-reader${isFocusMode ? " is-focus-mode" : ""}`}
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
      onClick={onReaderSurfaceClick}
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
            visible={chromeVisible && splashPhase === "done" && !isFocusMode}
            backLabel={backLabel}
            title={title}
            chapterTitle={chapterTitle}
            percent={percent}
            timeLeft={timeLeft}
            scrubValue={scrubValue}
            seeking={seeking}
            bookmarked={bookmarked}
            menuOpen={menuOpen}
            onMenuChange={setMenu}
            onBack={() => void handleBack()}
            onAppearance={() => openPanel("appearance")}
            onContents={() => {
              setWorkspaceTab("contents");
              openPanel("toc");
            }}
            onSearch={() => {
              setInbookSearchOpen((v) => !v);
              chromeRef.current?.onActivity();
              setChromeVisible(true);
            }}
            onBookmark={() => void handleBookmarkToggle().then(announceBookmark)}
            onShareQuote={() => setQuoteCardOpen(true)}
            shareEnabled={!!quoteSelection}
            onToggleChrome={handleToggleChrome}
            onHold={handleChromeHold}
            onPrevious={() => handleTurn("previous")}
            onNext={() => handleTurn("next")}
            onScrubStart={handleScrubStart}
            onScrubChange={handleScrubChange}
            onScrubEnd={handleScrubEnd}
            isFocusMode={isFocusMode}
            onFocusMode={() => setIsFocusMode((f) => !f)}
            onSessionInfo={() => setSessionInfoOpen(true)}
            onShortcutsGuide={() => setShortcutsGuideOpen(true)}
          />

          <InBookSearchPanel
            open={inbookSearchOpen}
            query={inbookQuery}
            results={inbookResults}
            isSearching={inbookSearching}
            searchError={inbookError}
            onQueryChange={setInbookQuery}
            onClear={() => {
              setInbookQuery("");
              setInbookResults([]);
              setInbookError(null);
            }}
            onClose={() => setInbookSearchOpen(false)}
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
              onToc={() => {
                setWorkspaceTab("contents");
                openPanel("toc");
              }}
              onBookmark={() => void handleBookmarkToggle().then(announceBookmark)}
            />
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
            initialTab={workspaceTab}
            entries={toc}
            currentHref={locator?.chapterHref}
            annotations={annotations}
            chapters={doc?.meta.chapters}
            onClose={() => setPanel(null)}
            onSelect={(href) => goToHref(href, "contents")}
            onSelectAnnotation={(target) =>
              navRef.current?.goToAnnotation(target, "annotation")
            }
            onRemoveBookmark={async (id) => {
              await getLibraryManager().annotations.remove(id);
              await refreshAnnotations(doc.docId);
              showNavNotice("Bookmark removed.");
            }}
            onDeleteAnnotation={async (id) => {
              await getLibraryManager().annotations.remove(id);
              await refreshAnnotations(doc.docId);
              showNavNotice("Annotation deleted.");
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
