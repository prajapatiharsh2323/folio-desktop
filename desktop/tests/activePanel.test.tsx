// Single active panel (R8): the chrome owns one panel slot covering TOC,
// Appearance and Search, so opening one closes the other. Appearance and
// Search render docked (non-modal: no scrim, Escape only with no modal on
// top); the TOC keeps its modal behaviour.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { MutableRefObject, RefObject } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { useReaderChrome } from "../src/screens/reader/useReaderChrome";
import { useInBookSearch } from "../src/screens/reader/useInBookSearch";
import { FolioPanel } from "../src/components/FolioPanel";
import { ChromeStateMachine } from "../src/reader/chrome";
import { pushModal, resetModalStack } from "../src/shell/modalStack";
import type { ReaderEngine } from "../src/reader/ReaderEngine";

// ---- useReaderChrome: one panel slot ---------------------------------------

describe("useReaderChrome single active panel (R8)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  // Stable per-test refs: the hook's effects key on these identities, so
  // freshly-created objects per render would loop the sync effect.
  let chromeRef: MutableRefObject<ChromeStateMachine | null>;
  let chromeApi: ReturnType<typeof useReaderChrome> | null;

  beforeEach(() => {
    root = null;
    chromeApi = null;
    chromeRef = { current: new ChromeStateMachine() };
    document.body.innerHTML = "";
  });

  it("openPanel replaces the active panel and togglePanel/closePanel clear it", () => {
    function Probe() {
      const chrome = useReaderChrome({
        docId: undefined, // skips keep-awake + auto-hide effects
        docProgressPercent: undefined,
        locatorProgression: undefined,
        chromeRef,
        keepAwakeRef: { current: null } as MutableRefObject<null>,
        setChromeVisible: () => {},
        navRef: { current: null } as RefObject<null>,
        paceRef: { current: null } as RefObject<null>,
        previousPercentRef: { current: null } as MutableRefObject<null>,
        holds: [],
        reportNavigation: () => {},
      });
      chromeApi = chrome;
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe />));

    act(() => chromeApi!.openPanel("toc"));
    expect(chromeApi!.panel).toBe("toc");

    act(() => chromeApi!.openPanel("search"));
    expect(chromeApi!.panel).toBe("search"); // toc closed by the same slot

    act(() => chromeApi!.openPanel("appearance"));
    expect(chromeApi!.panel).toBe("appearance");

    act(() => chromeApi!.togglePanel("appearance"));
    expect(chromeApi!.panel).toBeNull();

    act(() => chromeApi!.closePanel());
    expect(chromeApi!.panel).toBeNull();
  });
});

// ---- useInBookSearch: controlled open state --------------------------------

describe("useInBookSearch controlled open (R8)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let onOpenChange: ReturnType<typeof vi.fn>;
  let engineRef: RefObject<ReaderEngine | null>;
  let api: ReturnType<typeof useInBookSearch> | null = null;

  function renderHook(open: boolean) {
    function Probe() {
      const value = useInBookSearch({
        engineRef,
        navRef: { current: null } as RefObject<null>,
        open,
        onOpenChange,
        systemDark: false,
      });
      api = value;
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe />));
  }

  beforeEach(() => {
    root = null;
    api = null;
    onOpenChange = vi.fn();
    // Stable across renders: the debounce effect keys on the ref identity.
    engineRef = { current: null };
    document.body.innerHTML = "";
  });

  it("toggle routes through onOpenChange, not local state", () => {
    renderHook(false);
    act(() => api!.toggle());
    expect(onOpenChange).toHaveBeenCalledWith(true);

    renderHook(true);
    act(() => api!.toggle());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("close and reset always request closed", () => {
    renderHook(true);
    act(() => api!.close());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    act(() => api!.reset());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});

// ---- FolioPanel modal vs non-modal -----------------------------------------

describe("FolioPanel modal prop (R8)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  function render(modal: boolean | undefined) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <FolioPanel open modal={modal} onClose={() => {}} title="Panel">
          <button type="button">inner</button>
        </FolioPanel>,
      );
    });
  }

  beforeEach(() => {
    resetModalStack();
    root = null;
    document.body.innerHTML = "";
  });

  it("non-modal renders no scrim and no aria-modal", () => {
    render(false);
    expect(document.querySelector(".folio-overlay")).toBeNull();
    const panel = document.querySelector<HTMLDivElement>(".folio-panel")!;
    expect(panel.getAttribute("aria-modal")).toBeNull();
  });

  it("modal (default) keeps the scrim", () => {
    render(undefined);
    expect(document.querySelector(".folio-overlay")).not.toBeNull();
    expect(document.querySelector(".folio-panel")!.getAttribute("aria-modal")).toBe("true");
  });

  it("non-modal Escape closes while no modal is stacked", () => {
    const onClose = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <FolioPanel open modal={false} onClose={onClose} title="Docked">
          <button type="button">inner</button>
        </FolioPanel>,
      );
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("non-modal Escape is ignored while a modal surface is on top", () => {
    const onClose = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <FolioPanel open modal={false} onClose={onClose} title="Docked">
          <button type="button">inner</button>
        </FolioPanel>,
      );
    });
    const token = pushModal(); // e.g. a dialog opened from the docked panel
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    // The modal consumes the first Escape (its own behaviour); the docked
    // panel must not close on either press while the token is live.
    expect(onClose).not.toHaveBeenCalled();
    resetModalStack();
    void token;
  });
});
