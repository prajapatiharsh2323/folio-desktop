// Chrome state machine (07 §2): visibility holds, the More menu, side
// panels, focus mode, scrub interaction and the reveal-band pointer logic.
// The chrome owns nothing about the document; engine/nav/pace refs are passed
// in so page-turn, scrub and keep-awake behaviour keep working unchanged.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { ChromeStateMachine, CHROME_IDLE_MS, type ChromeHold } from "../../reader/chrome";
import type { ReaderNavigationCoordinator } from "../../reader/navigation";
import type { ReadingPaceStats } from "../../reader/pace";
import type { WorkspaceTab } from "../../components/TocPanel";
import { KeepAwakeController, readPreventSleepSetting } from "../../reader/keepAwake";
import { getLibraryFs } from "../../store/libraryUi";
import type { NavigationOutcome } from "../../reader/navigation";

/** Bottom hover band that reveals the dock (07 §2). */
const DOCK_REVEAL_ZONE_PX = 56;

export type ReaderPanel = "appearance" | "toc";

interface UseReaderChromeOptions {
  docId: string | undefined;
  docProgressPercent: number | undefined;
  /** Locator progression while reading (0..1); null until the first locator. */
  locatorProgression: number | undefined;
  /** Created in the screen: shared with the engine hook and event handlers. */
  chromeRef: MutableRefObject<ChromeStateMachine | null>;
  /** Created in the screen: the engine hook marks activity through it. */
  keepAwakeRef: MutableRefObject<KeepAwakeController | null>;
  /** Visibility lives in the screen so the engine hook can reflect it too. */
  setChromeVisible: Dispatch<SetStateAction<boolean>>;
  navRef: RefObject<ReaderNavigationCoordinator | null>;
  paceRef: RefObject<ReadingPaceStats | null>;
  previousPercentRef: MutableRefObject<number | null>;
  /** Chrome holds owned elsewhere (dialogs, search, selection). */
  holds: { reason: ChromeHold; active: boolean }[];
  reportNavigation: (pending: Promise<NavigationOutcome>, message: string) => void;
}

/** Chrome visibility, menu/panel state, focus mode and scrub interaction. */
export function useReaderChrome({
  docId,
  docProgressPercent,
  locatorProgression,
  chromeRef,
  keepAwakeRef,
  setChromeVisible,
  navRef,
  paceRef,
  previousPercentRef,
  holds,
  reportNavigation,
}: UseReaderChromeOptions) {
  /** Mirror of scrubValue: the dock can release twice (keyup + blur). */
  const scrubValueRef = useRef<number | null>(null);

  const [menuOpen, setMenuOpenState] = useState(false);
  const menuOpenRef = useRef(false);
  const [panel, setPanelState] = useState<ReaderPanel | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("contents");
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [scrubValue, setScrubValue] = useState<number | null>(null);

  const setMenu = useCallback((open: boolean) => {
    menuOpenRef.current = open;
    setMenuOpenState(open);
  }, []);

  const openPanel = useCallback(
    (next: ReaderPanel) => {
      // Opening a panel is reading activity: break the pace session and pin
      // the chrome up while the user works in the panel (07 §2).
      paceRef.current?.breakSession(Date.now());
      chromeRef.current?.onActivity();
      setChromeVisible(true);
      setPanelState(next);
      setWorkspaceTab("contents");
    },
    [paceRef, chromeRef, setChromeVisible],
  );

  const closePanel = useCallback(() => setPanelState(null), []);

  /** 't' key: toggle the TOC panel without breaking the pace session (07 §1). */
  const togglePanel = useCallback(
    (next: ReaderPanel) => {
      chromeRef.current?.onActivity();
      setChromeVisible(true);
      setWorkspaceTab("contents");
      setPanelState((current) => (current === next ? null : next));
    },
    [chromeRef, setChromeVisible],
  );

  /** Ctrl+F-style toggles and focus-mode Escape exit reuse these. */
  const toggleFocusMode = useCallback(() => {
    setIsFocusMode((f) => !f);
  }, []);

  const exitFocusMode = useCallback(() => setIsFocusMode(false), []);

  /** Focus/pointer holds keep the chrome up while the user works in it. */
  const handleChromeHold = useCallback(
    (reason: "focus" | "pointer", active: boolean) => {
      const chrome = chromeRef.current;
      if (!chrome) return;
      if (active) chrome.hold(reason);
      else chrome.release(reason);
      setChromeVisible(chrome.visible);
    },
    [chromeRef, setChromeVisible],
  );

  // ---- chrome holds: menus, panels, dialogs, search, selection -------------
  // `holds` carries the externally-owned interactions (dialog, search,
  // selection, and an external menu contribution); menu/panel come from the
  // hook's own state. One sync pass keeps hold/reflection atomic like the
  // original single effect.
  useEffect(() => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    const external = new Map(holds.map((h) => [h.reason, h.active]));
    const sync = (reason: ChromeHold, active: boolean) => {
      if (active) chrome.hold(reason);
      else chrome.release(reason);
    };
    sync("menu", menuOpen || external.get("menu") === true);
    sync("panel", panel !== null);
    sync("dialog", external.get("dialog") === true);
    sync("search", external.get("search") === true);
    sync("selection", external.get("selection") === true);
    setChromeVisible(chrome.visible);
  }, [menuOpen, panel, holds, chromeRef, setChromeVisible]);

  // ---- chrome auto-hide tick ----------------------------------------------
  useEffect(() => {
    if (!docId) return;
    const chromeTimer = setInterval(
      () => {
        const chrome = chromeRef.current;
        if (!chrome) return;
        setChromeVisible(chrome.tick() === "visible");
      },
      Math.min(250, CHROME_IDLE_MS / 4),
    );
    return () => clearInterval(chromeTimer);
  }, [docId, chromeRef, setChromeVisible]);

  // ---- keep-awake polling (09 §4: reader only) -----------------------------
  useEffect(() => {
    if (!docId) return;
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
  }, [docId, keepAwakeRef]);

  // ---- scrub ---------------------------------------------------------------
  const handleScrubStart = useCallback(() => {
    chromeRef.current?.onScrubStart();
    paceRef.current?.breakSession(Date.now());
    previousPercentRef.current = null;
    const current = (locatorProgression ?? (docProgressPercent ?? 0) / 100) * 100;
    scrubValueRef.current = current;
    setScrubValue(current);
  }, [docProgressPercent, locatorProgression, paceRef, previousPercentRef, chromeRef]);

  const handleScrubChange = useCallback(
    (percent: number) => {
      scrubValueRef.current = percent;
      setScrubValue(percent);
      chromeRef.current?.onActivity();
    },
    [chromeRef, scrubValueRef],
  );

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
    [navRef, reportNavigation, chromeRef, scrubValueRef],
  );

  const handleToggleChrome = useCallback(() => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    chrome.release("menu");
    chrome.release("focus");
    chrome.toggle();
    setChromeVisible(chrome.visible);
  }, [chromeRef, setChromeVisible]);

  // ---- pointer behaviour ---------------------------------------------------
  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
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
    },
    [isFocusMode, chromeRef, setChromeVisible],
  );

  const onReaderSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isFocusMode) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          ".folio-reader-chrome, .folio-panel, .folio-overlay, .folio-reader-menu, .folio-reader-ctxmenu, .folio-inbook-search-panel, .folio-selection-toolbar, .folio-dialog, [role='dialog'], .folio-snackbar, .folio-reader-splash, .folio-reader-focus-exit",
        )
      ) {
        return;
      }
      chromeRef.current?.onActivity();
      setChromeVisible(true);
    },
    [isFocusMode, chromeRef, setChromeVisible],
  );

  return {
    menuOpenRef,
    menuOpen,
    setMenu,
    panel,
    openPanel,
    closePanel,
    togglePanel,
    workspaceTab,
    setWorkspaceTab,
    isFocusMode,
    toggleFocusMode,
    exitFocusMode,
    scrubValue,
    handleChromeHold,
    handleScrubStart,
    handleScrubChange,
    handleScrubEnd,
    handleToggleChrome,
    onMouseMove,
    onReaderSurfaceClick,
  };
}
