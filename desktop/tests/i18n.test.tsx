// X5 (Phase 4): string catalogue, locale handling, RTL page progression.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const memory = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/lib/storage", () => ({
  readStorage: (key: string) => memory.get(key) ?? null,
  writeStorage: (key: string, value: string) => {
    memory.set(key, String(value));
  },
  removeStorage: (key: string) => {
    memory.delete(key);
  },
}));

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  applyLocale,
  initLocale,
  isRtlLocale,
  localeDir,
  readStoredLocale,
  t,
  useLocaleStore,
} from "../src/i18n/i18n";
import { Sidebar } from "../src/shell/Sidebar";
import { CommandPalette } from "../src/components/CommandPalette";
import type { ReaderDoc } from "../src/store/readerStore";
import type { ReaderEngine } from "../src/reader/ReaderEngine";
import type { ReaderNavigationCoordinator } from "../src/reader/navigation";
import type { ChromeStateMachine } from "../src/reader/chrome";
import type { BookmarkResult } from "../src/screens/reader/useAnnotations";
import { useReaderKeyboard } from "../src/screens/reader/useReaderKeyboard";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(ui: React.ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

beforeEach(() => {
  memory.clear();
  useLocaleStore.setState({ locale: DEFAULT_LOCALE });
  document.documentElement.lang = "";
  document.documentElement.dir = "";
});

describe("catalogue + t()", () => {
  it("falls back to English for untranslated keys and echoes unknown keys", () => {
    expect(t("nav.library", "en")).toBe("Library");
    expect(t("nav.library", "hi")).toBe("पुस्तकालय");
    // keys without a Hindi entry resolve to the English string
    expect(t("nav.aria", "hi")).toBe("मुख्य नेविगेशन");
    expect(t("not.a.key" as never, "hi")).toBe("not.a.key");
  });

  it("uses the current store locale when none is passed", () => {
    expect(t("nav.notes")).toBe("Notes");
    act(() => useLocaleStore.getState().setLocale("hi"));
    expect(t("nav.notes")).toBe("नोट्स");
  });
});

describe("locale application", () => {
  it("isRtlLocale / localeDir", () => {
    expect(isRtlLocale("en")).toBe(false);
    expect(isRtlLocale("hi")).toBe(false);
    expect(isRtlLocale("ar")).toBe(true);
    expect(localeDir("en")).toBe("ltr");
    expect(localeDir("ar")).toBe("rtl");
  });

  it("setLocale persists and sets lang/dir on <html>", () => {
    act(() => useLocaleStore.getState().setLocale("ar"));
    expect(memory.get(LOCALE_STORAGE_KEY)).toBe("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");

    act(() => useLocaleStore.getState().setLocale("hi"));
    expect(document.documentElement.lang).toBe("hi");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("initLocale is the pre-paint hook (read + apply, no write)", () => {
    memory.set(LOCALE_STORAGE_KEY, "ar");
    initLocale();
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(useLocaleStore.getState().locale).toBe("ar");
  });

  it("readStoredLocale rejects unknown values", () => {
    memory.set(LOCALE_STORAGE_KEY, "fr");
    expect(readStoredLocale()).toBe("en");
    applyLocale(readStoredLocale());
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("Sidebar labels (X5)", () => {
  it("renders translated labels and re-renders when the locale changes", () => {
    const onNavigate = vi.fn();
    const el = mount(<Sidebar route="library" onNavigate={onNavigate} />);
    expect(el.textContent).toContain("Library");
    act(() => useLocaleStore.getState().setLocale("hi"));
    expect(el.textContent).toContain("पुस्तकालय");
    expect(el.querySelector("nav")!.getAttribute("aria-label")).toBe("मुख्य नेविगेशन");
  });
});

describe("CommandPalette labels (X5)", () => {
  it("lists commands in the active locale", () => {
    act(() => useLocaleStore.getState().setLocale("hi"));
    const el = mount(<CommandPalette open onClose={() => {}} />);
    expect(el.textContent).toContain("पुस्तकालय खोलें");
  });
});

describe("RTL page progression (X5)", () => {
  /** Same minimal harness as readerKeyboardBack.test.tsx, with spied turns. */
  function renderHarness(opts: { goBack: () => void; goForward: () => void }) {
    const turnNext = vi.fn(() => Promise.resolve({ ok: true, superseded: false }));
    const turnPrevious = vi.fn(() => Promise.resolve({ ok: true, superseded: false }));
    const reportNavigation = vi.fn();
    const noop = () => {};
    function Harness() {
      useReaderKeyboard({
        doc: { docId: "d" } as unknown as ReaderDoc,
        engineRef: { current: {} as ReaderEngine },
        navRef: {
          current: {
            next: turnNext,
            previous: turnPrevious,
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
        toggleSearch: noop,
        searchNext: noop,
        searchPrev: noop,
        goBack: opts.goBack,
        goForward: opts.goForward,
        onTextSize: noop,
        stepChapter: noop,
        clearSelection: noop,
        ctxMenu: null,
        clearCtxMenu: noop,
        setShortcutsGuideOpen: noop,
        reportNavigation,
        showNavNotice: noop,
        announceBookmark: noop,
        setChromeVisible: noop,
      });
      return null;
    }
    mount(<Harness />);
    return { turnNext, turnPrevious, reportNavigation };
  }

  function press(key: string, init: KeyboardEventInit = {}) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    });
  }

  it("LTR (default): ArrowRight turns forward, ArrowLeft turns back", () => {
    const h = renderHarness({ goBack: vi.fn(), goForward: vi.fn() });
    press("ArrowRight");
    expect(h.turnNext).toHaveBeenCalledTimes(1);
    expect(h.turnPrevious).not.toHaveBeenCalled();
    press("ArrowLeft");
    expect(h.turnPrevious).toHaveBeenCalledTimes(1);
  });

  it("RTL (Arabic): ArrowRight turns back, ArrowLeft turns forward", () => {
    act(() => useLocaleStore.getState().setLocale("ar"));
    const h = renderHarness({ goBack: vi.fn(), goForward: vi.fn() });
    press("ArrowRight");
    expect(h.turnPrevious).toHaveBeenCalledTimes(1);
    expect(h.turnNext).not.toHaveBeenCalled();
    press("ArrowLeft");
    expect(h.turnNext).toHaveBeenCalledTimes(1);
  });

  it("Alt+Left/Right keep their history meanings in RTL", () => {
    act(() => useLocaleStore.getState().setLocale("ar"));
    const goBack = vi.fn();
    const goForward = vi.fn();
    renderHarness({ goBack, goForward });
    press("ArrowLeft", { altKey: true });
    expect(goBack).toHaveBeenCalledTimes(1);
    press("ArrowRight", { altKey: true });
    expect(goForward).toHaveBeenCalledTimes(1);
  });
});
