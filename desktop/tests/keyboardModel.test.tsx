// Keyboard model (R13): bare letters ignore modifier combos, Ctrl+=/−/0 size
// the text, [ / ] step chapters, and the Escape ladder only owns non-modal
// surfaces (dialogs close themselves through the modal stack).
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

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

const noop = () => {};

describe("reader keyboard model (R13)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let calls: {
    togglePanel: ReturnType<typeof vi.fn>;
    toggleSearch: ReturnType<typeof vi.fn>;
    toggleFocusMode: ReturnType<typeof vi.fn>;
    toggleLineFocus: ReturnType<typeof vi.fn>;
    onTextSize: ReturnType<typeof vi.fn>;
    stepChapter: ReturnType<typeof vi.fn>;
    clearSelection: ReturnType<typeof vi.fn>;
    setMenu: ReturnType<typeof vi.fn>;
    setShortcutsGuideOpen: ReturnType<typeof vi.fn>;
    chromeToggle: ReturnType<typeof vi.fn>;
  };

  function renderHarness() {
    calls = {
      togglePanel: vi.fn(),
      toggleSearch: vi.fn(),
      toggleFocusMode: vi.fn(),
      toggleLineFocus: vi.fn(),
      onTextSize: vi.fn(),
      stepChapter: vi.fn(),
      clearSelection: vi.fn(),
      setMenu: vi.fn(),
      setShortcutsGuideOpen: vi.fn(),
      chromeToggle: vi.fn(),
    };
    function Harness() {
      useReaderKeyboard({
        doc: { docId: "d" } as unknown as ReaderDoc,
        engineRef: { current: {} as ReaderEngine },
        navRef: {
          current: {
            next: () => Promise.resolve({ ok: true, superseded: false }),
            previous: () => Promise.resolve({ ok: true, superseded: false }),
          } as unknown as ReaderNavigationCoordinator,
        },
        chromeRef: { current: { toggle: calls.chromeToggle } as unknown as ChromeStateMachine },
        bookmarkToggleRef: { current: () => Promise.resolve("added" as BookmarkResult) },
        isFocusMode: false,
        toggleFocusMode: calls.toggleFocusMode,
        exitFocusMode: noop,
        lineFocusOpen: false,
        toggleLineFocus: calls.toggleLineFocus,
        panel: null,
        closePanel: noop,
        togglePanel: calls.togglePanel,
        menuOpenRef: { current: false },
        setMenu: calls.setMenu,
        toggleSearch: calls.toggleSearch,
        searchNext: noop,
        searchPrev: noop,
        goBack: noop,
        goForward: noop,
        onTextSize: calls.onTextSize,
        stepChapter: calls.stepChapter,
        clearSelection: calls.clearSelection,
        ctxMenu: null,
        clearCtxMenu: noop,
        setShortcutsGuideOpen: calls.setShortcutsGuideOpen,
        reportNavigation: noop,
        showNavNotice: noop,
        announceBookmark: noop,
        setChromeVisible: noop,
      });
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Harness />));
  }

  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
    renderHarness();
  });

  it("bare letters fire their shortcuts", () => {
    press("t");
    press("m");
    press("f");
    press("?");
    expect(calls.togglePanel).toHaveBeenCalledWith("toc");
    expect(calls.chromeToggle).toHaveBeenCalledTimes(1);
    expect(calls.toggleFocusMode).toHaveBeenCalledTimes(1);
    expect(calls.setShortcutsGuideOpen).toHaveBeenCalledTimes(1);
    expect(calls.toggleSearch).not.toHaveBeenCalled();
  });

  it("letters with modifiers are ignored (browser/app combos win)", () => {
    press("t", { ctrlKey: true });
    press("t", { altKey: true });
    press("t", { metaKey: true });
    press("m", { ctrlKey: true });
    press("f", { altKey: true });
    press("?", { ctrlKey: true });
    expect(calls.togglePanel).not.toHaveBeenCalled();
    expect(calls.chromeToggle).not.toHaveBeenCalled();
    expect(calls.toggleFocusMode).not.toHaveBeenCalled();
    expect(calls.toggleSearch).not.toHaveBeenCalled();
    expect(calls.setShortcutsGuideOpen).not.toHaveBeenCalled();
  });

  it("Ctrl+F still searches and unmodified F still toggles distraction-free", () => {
    press("f", { ctrlKey: true });
    expect(calls.toggleSearch).toHaveBeenCalledTimes(1);
    expect(calls.toggleFocusMode).not.toHaveBeenCalled();

    press("F", { shiftKey: true }); // Shift is not a "combo" modifier
    expect(calls.toggleFocusMode).toHaveBeenCalledTimes(1);
  });

  it("F9 5.2c: bare L toggles the line-focus band; combos are ignored", () => {
    press("l");
    press("L", { shiftKey: true });
    expect(calls.toggleLineFocus).toHaveBeenCalledTimes(2);

    press("l", { ctrlKey: true });
    press("l", { altKey: true });
    expect(calls.toggleLineFocus).toHaveBeenCalledTimes(2); // unchanged
  });

  it("the Escape ladder clears the line-focus band before distraction-free", () => {
    act(() => root!.unmount());
    function Harness() {
      useReaderKeyboard({
        doc: { docId: "d" } as unknown as ReaderDoc,
        engineRef: { current: {} as ReaderEngine },
        navRef: { current: null },
        chromeRef: { current: null },
        bookmarkToggleRef: { current: () => Promise.resolve("added" as BookmarkResult) },
        isFocusMode: true,
        toggleFocusMode: noop,
        exitFocusMode: calls.toggleFocusMode, // spy: must NOT fire for line focus
        lineFocusOpen: true,
        toggleLineFocus: calls.toggleLineFocus,
        panel: null,
        closePanel: noop,
        togglePanel: noop,
        menuOpenRef: { current: false },
        setMenu: noop,
        toggleSearch: noop,
        searchNext: noop,
        searchPrev: noop,
        goBack: noop,
        goForward: noop,
        onTextSize: noop,
        stepChapter: noop,
        clearSelection: calls.clearSelection,
        ctxMenu: null,
        clearCtxMenu: noop,
        setShortcutsGuideOpen: noop,
        reportNavigation: noop,
        showNavNotice: noop,
        announceBookmark: noop,
        setChromeVisible: noop,
      });
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Harness />));
    press("Escape");
    expect(calls.toggleLineFocus).toHaveBeenCalledTimes(1);
    expect(calls.toggleFocusMode).not.toHaveBeenCalled();
    expect(calls.clearSelection).not.toHaveBeenCalled();
  });

  it("Ctrl+=/−/0 drive text size; bare keys and plain digits do nothing", () => {
    press("=", { ctrlKey: true });
    press("+", { ctrlKey: true });
    press("-", { ctrlKey: true });
    press("_", { ctrlKey: true });
    press("0", { ctrlKey: true });
    expect(calls.onTextSize.mock.calls).toEqual([
      ["larger"],
      ["larger"],
      ["smaller"],
      ["smaller"],
      ["reset"],
    ]);

    press("=");
    press("-", { altKey: true });
    press("0");
    expect(calls.onTextSize).toHaveBeenCalledTimes(5); // unchanged
  });

  it("[ and ] step chapters", () => {
    press("[");
    press("]");
    expect(calls.stepChapter.mock.calls).toEqual([["previous"], ["next"]]);
  });

  it("the Escape ladder handles non-modal surfaces and the tail clears selection", () => {
    press("Escape");
    expect(calls.clearSelection).toHaveBeenCalledTimes(1);
    expect(calls.setMenu).not.toHaveBeenCalled();

    // Menu branch: setMenu(false) and refocus the More button.
    // (Re-render with menuOpenRef.current = true.)
    act(() => root!.unmount());
    const menuOpenRef = { current: true };
    function Harness() {
      useReaderKeyboard({
        doc: { docId: "d" } as unknown as ReaderDoc,
        engineRef: { current: {} as ReaderEngine },
        navRef: { current: null },
        chromeRef: { current: null },
        bookmarkToggleRef: { current: () => Promise.resolve("added" as BookmarkResult) },
        isFocusMode: false,
        toggleFocusMode: noop,
        exitFocusMode: noop,
        lineFocusOpen: false,
        toggleLineFocus: noop,
        panel: null,
        closePanel: noop,
        togglePanel: noop,
        menuOpenRef,
        setMenu: calls.setMenu,
        toggleSearch: noop,
        searchNext: noop,
        searchPrev: noop,
        goBack: noop,
        goForward: noop,
        onTextSize: noop,
        stepChapter: noop,
        clearSelection: calls.clearSelection,
        ctxMenu: null,
        clearCtxMenu: noop,
        setShortcutsGuideOpen: noop,
        reportNavigation: noop,
        showNavNotice: noop,
        announceBookmark: noop,
        setChromeVisible: noop,
      });
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Harness />));
    press("Escape");
    expect(calls.setMenu).toHaveBeenCalledWith(false);
    expect(calls.clearSelection).toHaveBeenCalledTimes(1); // unchanged
  });
});
