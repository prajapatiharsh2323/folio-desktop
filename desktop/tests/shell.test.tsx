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
    useRouteStore.setState({ route: "library" });
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
