// R4 back navigation through the reader keyboard matrix: Alt+Left returns
// through the coordinator's position history; plain ArrowLeft still turns the
// page. The hook reads only truthiness of `doc`/engine, so minimal doubles
// are cast to the required types.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReaderDoc } from "../src/store/readerStore";
import type { ReaderEngine } from "../src/reader/ReaderEngine";
import type { ReaderNavigationCoordinator } from "../src/reader/navigation";
import type { ChromeStateMachine } from "../src/reader/chrome";
import type { BookmarkResult } from "../src/screens/reader/useAnnotations";
import { useReaderKeyboard } from "../src/screens/reader/useReaderKeyboard";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function renderHarness(opts: {
  goBack: () => void;
  reportNavigation: (pending: Promise<unknown>, message: string) => void;
}) {
  const noop = () => {};
  function Harness() {
    useReaderKeyboard({
      doc: { docId: "d" } as unknown as ReaderDoc,
      engineRef: { current: {} as ReaderEngine },
      navRef: {
        current: {
          next: () => Promise.resolve({ ok: true, superseded: false }),
          previous: () => Promise.resolve({ ok: true, superseded: false }),
          goToPercent: () => Promise.resolve({ ok: true, superseded: false }),
          goBack: () => Promise.resolve({ ok: true, superseded: false }),
        } as unknown as ReaderNavigationCoordinator,
      },
      chromeRef: { current: null as unknown as ChromeStateMachine },
      bookmarkToggleRef: { current: () => Promise.resolve("added" as BookmarkResult) },
      isFocusMode: false,
      toggleFocusMode: noop,
      exitFocusMode: noop,
      panel: null,
      closePanel: noop,
      togglePanel: noop,
      menuOpenRef: { current: false },
      setMenu: noop,
      searchOpen: false,
      setSearchOpen: noop,
      searchNext: noop,
      searchPrev: noop,
      goBack: opts.goBack,
      clearSelection: noop,
      ctxMenu: null,
      clearCtxMenu: noop,
      noteEditorOpen: false,
      closeNoteEditor: noop,
      quoteCardOpen: false,
      setQuoteCardOpen: noop,
      sessionInfoOpen: false,
      setSessionInfoOpen: noop,
      shortcutsGuideOpen: false,
      setShortcutsGuideOpen: noop,
      reportNavigation: opts.reportNavigation,
      showNavNotice: noop,
      announceBookmark: noop,
      setChromeVisible: noop,
    });
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness />);
  });
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

describe("reader keyboard back navigation (R4)", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("Alt+ArrowLeft goes back through the position history", () => {
    const goBack = vi.fn();
    renderHarness({ goBack, reportNavigation: () => {} });

    press("ArrowLeft", { altKey: true });
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it("plain ArrowLeft still turns the page back", () => {
    const goBack = vi.fn();
    const reportNavigation = vi.fn();
    renderHarness({ goBack, reportNavigation });

    press("ArrowLeft");
    expect(goBack).not.toHaveBeenCalled();
    // Page turns funnel through the coordinator via reportNavigation.
    expect(reportNavigation).toHaveBeenCalledTimes(1);
  });

  it("PageUp ignores Alt and turns the page", () => {
    const goBack = vi.fn();
    renderHarness({ goBack, reportNavigation: () => {} });

    press("PageUp", { altKey: true });
    expect(goBack).not.toHaveBeenCalled();
  });
});
