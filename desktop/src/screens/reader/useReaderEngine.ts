// Engine lifecycle (04 §8): one Readium engine, one navigation coordinator,
// one progress writer per open book. Splash/locator/TOC/seek/pace state lives
// here so the screen keeps only chrome, dialogs and event wiring. The effect
// deps stay `[docId, retryNonce, request]` — a location change must navigate,
// never rebuild the engine.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { ReaderDoc } from "../../store/readerStore";
import type { ReaderOpenRequest } from "../../store/routeStore";
import type { ReadingPrefs, Annotation } from "../../model/types";
import type {
  ReaderEngine,
  ReaderLocator,
  TextSelectionInfo,
  TocEntry,
} from "../../reader/ReaderEngine";
import type { ChromeStateMachine } from "../../reader/chrome";
import { intentForReaderClick } from "../../reader/chrome";
import type { NavigationOutcome } from "../../reader/navigation";
import {
  createNavigationCoordinator,
  type ReaderNavigationCoordinator,
} from "../../reader/navigation";
import { ProgressWriter } from "../../reader/progress";
import { ReadingPaceStats, type PaceState } from "../../reader/pace";
import { resumePlan } from "../../reader/resume";
import { createReadiumEngine } from "../../reader/readiumEngine";
import type { KeepAwakeController } from "../../reader/keepAwake";
import { openExternal } from "./launchExternal";
import { planTarget } from "./resumeTargets";
import type { SplashPhase } from "../../components/ReaderSplash";

const SPLASH_FADE_MS = 300;
const SPLASH_FAILSAFE_MS = 8000;

interface UseReaderEngineOptions {
  doc: ReaderDoc | null;
  request: ReaderOpenRequest | null;
  retryNonce: number;
  canvasRef: RefObject<HTMLDivElement | null>;
  /** Created in the screen: shared with the annotations hook and chrome. */
  engineRef: MutableRefObject<ReaderEngine | null>;
  navRef: MutableRefObject<ReaderNavigationCoordinator | null>;
  prefsRef: MutableRefObject<ReadingPrefs>;
  chromeRef: RefObject<ChromeStateMachine | null>;
  keepAwakeRef: RefObject<KeepAwakeController | null>;
  /** A live selection owns the pointer — edge clicks must not turn the page. */
  selectionRef: MutableRefObject<TextSelectionInfo | null>;
  contextMenuRef: MutableRefObject<(x: number, y: number) => void>;
  /** Focus mode is read through this ref inside engine callbacks (E2 fix). */
  isFocusModeRef: MutableRefObject<boolean>;
  previousPercentRef: MutableRefObject<number | null>;
  setChromeVisible: Dispatch<SetStateAction<boolean>>;
  /** New text selection (or cleared with null); the screen owns the UI. */
  onSelection: (sel: TextSelectionInfo | null) => void;
  reportNavigation: (pending: Promise<NavigationOutcome>, message: string) => void;
  refreshAnnotations: (docId: string) => Promise<Annotation[]>;
  persistProgress: (snapshot: {
    location: string;
    percent: number;
    pace?: PaceState | null;
  }) => Promise<void>;
}

export function useReaderEngine({
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
  onSelection,
  reportNavigation,
  refreshAnnotations,
  persistProgress,
}: UseReaderEngineOptions) {
  const writerRef = useRef<ProgressWriter | null>(null);
  const paceRef = useRef<ReadingPaceStats | null>(null);
  const seekingRef = useRef(false);
  const disposedRef = useRef(false);
  const lastPacePublishRef = useRef(0);

  // The doc object is replaced on every progress write; the engine must not
  // rebuild then. The effect reads the freshest doc through this ref while its
  // deps key on the identity that actually matters: the docId.
  const docRef = useRef(doc);
  docRef.current = doc;
  const docId = doc?.docId;

  const [splash, setSplash] = useState<SplashPhase>("loading");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [locator, setLocator] = useState<ReaderLocator | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [seeking, setSeeking] = useState(false);
  /** Bumped at most once a second so pace-derived labels stay live without
   *  re-rendering on every scroll locator. */
  const [paceVersion, setPaceVersion] = useState(0);

  // Cross-fade after the first locator (300 ms, 03 §6).
  useEffect(() => {
    if (splash !== "fading") return;
    const timer = setTimeout(() => setSplash("done"), SPLASH_FADE_MS);
    return () => clearTimeout(timer);
  }, [splash]);

  // ---- engine lifecycle ----------------------------------------------------
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    disposedRef.current = false;
    const plan = resumePlan(
      doc.progress ? { location: doc.progress.location, percent: doc.progress.percent } : null,
      request
        ? { location: request.location, percent: request.percent, anchor: request.anchor }
        : null,
    );
    const target = planTarget(plan);
    const restorePending = plan.kind !== "first";

    const engine = createReadiumEngine({
      epubBytes: doc.epubBytes,
      prefs: prefsRef.current,
      initial: target,
    });
    engineRef.current = engine;

    // Create pacing before the coordinator: its onBeforeMove callback closes
    // over this binding, and the coordinator may invoke it during setup.
    const pace = new ReadingPaceStats(doc.progress?.pace ?? null);
    paceRef.current = pace;

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
      // Focus mode is read through the ref: this handler lives as long as the
      // engine, so a state read would go stale after the first toggle (E2).
      if (chrome.visible && !isFocusModeRef.current) chrome.onActivity();
      if (intent === "next") {
        reportNavigation(nav.next("page-edge"), "Couldn't turn the page forward.");
      } else {
        reportNavigation(nav.previous("page-edge"), "Couldn't turn the page back.");
      }
      return true;
    });

    const offSelection = engine.onSelection((sel) => {
      onSelection(sel);
      if (sel) paceRef.current?.breakSession(Date.now());
    });

    const offLink = engine.onLink((href) => openExternal(href));
    const offPointer = engine.onPointerActivity(() => {
      const chrome = chromeRef.current;
      if (!chrome || isFocusModeRef.current) return;
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
    // Deps key on docId (via docRef for the doc body): progress and prefs
    // writes replace the doc object and must never rebuild the engine — a
    // location change navigates instead (04 §8).
  }, [
    docId,
    docRef,
    retryNonce,
    request,
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
    onSelection,
    reportNavigation,
    refreshAnnotations,
    persistProgress,
  ]);

  /** Retry clears the transient engine state and re-runs the effect. */
  const resetForRetry = useCallback(() => {
    setEngineError(null);
    setLocator(null);
    setSplash("loading");
  }, []);

  /** Doc (re)load clears the TOC until the new engine reports its own. */
  const resetToc = useCallback(() => setToc([]), []);

  return {
    engineRef,
    navRef,
    writerRef,
    paceRef,
    disposedRef,
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
  };
}
