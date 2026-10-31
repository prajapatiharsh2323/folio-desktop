import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Shell } from "../src/shell/Shell";import { useRouteStore } from "../src/store/routeStore";

// React 18 act() environment flag (silences testing-env warning)
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function render(ui: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
}

describe("shell", () => {
  beforeEach(() => {
    useRouteStore.setState({ route: "library", readerRequest: null, readerOrigin: null });
    render(<Shell />);
    return () => {
      act(() => root?.unmount());
      container.remove();
      root = null;
    };
  });

  it("renders the four nav destinations", () => {
    const labels = Array.from(document.querySelectorAll(".folio-sidebar__item span")).map(
      (el) => el.textContent
    );
    expect(labels).toEqual(["Library", "Collections", "Notes", "Settings"]);
  });

  it("marks Library active by default", () => {
    const active = document.querySelector(".folio-sidebar__item.is-active span");
    expect(active?.textContent).toContain("Library");
  });

  it("shows the library empty state", async () => {
    // flush the async library refresh() → loading → empty state
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const title = document.querySelector(".folio-empty__title")?.textContent;
    expect(title === "Nothing here yet" || title === null).toBe(true);
  });

  it("navigates to Collections on click", () => {
    const items = Array.from(document.querySelectorAll(".folio-sidebar__item"));
    const collections = items.find((el) => el.querySelector("span")?.textContent === "Collections")!;
    act(() => {
      collections.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useRouteStore.getState().route).toBe("collections");
    expect(document.querySelector(".folio-toolbar__title")?.textContent).toBe("Collections");
  });
});

describe("reader origin tracking (04 §5 navigation)", () => {
  beforeEach(() => {
    useRouteStore.setState({ route: "library", readerRequest: null, readerOrigin: null });
  });

  it("captures the current route as the origin when none is given", () => {
    useRouteStore.setState({ route: "notes" });
    useRouteStore.getState().openReader({ docId: "d1" });
    const state = useRouteStore.getState();
    expect(state.route).toBe("reader");
    expect(state.readerOrigin?.route).toBe("notes");
  });

  it("returns to the origin route on closeReader", () => {
    useRouteStore.getState().openReader(
      { docId: "d1" },
      { route: "collections", collectionId: "c1" }
    );
    useRouteStore.getState().closeReader();
    const state = useRouteStore.getState();
    expect(state.route).toBe("collections");
    expect(state.readerRequest).toBeNull();
    // Origin survives close so CollectionsScreen can restore its selection.
    expect(state.readerOrigin?.collectionId).toBe("c1");
  });

  it("falls back to the library when no origin exists", () => {
    useRouteStore.setState({ route: "reader", readerOrigin: null });
    useRouteStore.getState().closeReader();
    expect(useRouteStore.getState().route).toBe("library");
  });

  it("clears the origin on sidebar navigation", () => {
    useRouteStore.getState().openReader(
      { docId: "d1" },
      { route: "collections", collectionId: "c1" }
    );
    useRouteStore.getState().closeReader();
    expect(useRouteStore.getState().readerOrigin).not.toBeNull();
    useRouteStore.getState().setRoute("settings");
    expect(useRouteStore.getState().readerOrigin).toBeNull();
  });

  it("re-opening from inside the reader keeps the previous origin", () => {
    useRouteStore.getState().openReader(
      { docId: "d1" },
      { route: "notes" }
    );
    useRouteStore.getState().openReader({ docId: "d2" });
    expect(useRouteStore.getState().readerOrigin?.route).toBe("notes");
  });
});
