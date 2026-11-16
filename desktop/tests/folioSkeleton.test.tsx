// X2 (Phase 4): skeleton loading rows.
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { FolioSkeletonRows } from "../src/components/FolioSkeleton";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(ui: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("FolioSkeletonRows", () => {
  it("renders list rows with a busy status and a screen-reader label", () => {
    mount(<FolioSkeletonRows rows={3} />);
    const rootEl = container!.querySelector(".folio-skeleton")!;
    expect(rootEl.getAttribute("role")).toBe("status");
    expect(rootEl.getAttribute("aria-busy")).toBe("true");
    expect(rootEl.querySelector(".folio-visually-hidden")?.textContent).toBe("Loading…");
    expect(container!.querySelectorAll(".folio-skeleton-row").length).toBe(3);
    expect(container!.querySelectorAll(".folio-skeleton-cover").length).toBe(3);
    expect(container!.querySelectorAll(".folio-skeleton-bar").length).toBe(6);
  });

  it("renders grid cards with the grid modifier", () => {
    mount(<FolioSkeletonRows rows={4} view="grid" />);
    expect(container!.querySelector(".folio-skeleton--grid")).not.toBeNull();
    expect(container!.querySelectorAll(".folio-skeleton-card").length).toBe(4);
  });

  it("all placeholders are aria-hidden (decorative)", () => {
    mount(<FolioSkeletonRows rows={2} view="grid" />);
    for (const el of container!.querySelectorAll(".folio-skeleton-card")) {
      expect(el.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
