import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { memory } = vi.hoisted(() => ({ memory: new Map<string, string>() }));

vi.mock("../src/lib/storage", () => ({
  readStorage: (key: string) => memory.get(key) ?? null,
  writeStorage: (key: string, value: string) => memory.set(key, value),
  removeStorage: (key: string) => memory.delete(key),
}));

import { Tour } from "../src/onboarding/Tour";
import {
  TOUR_COMPLETE_KEY,
  useOnboarding,
} from "../src/onboarding/onboardingState";
import { useRouteStore } from "../src/store/routeStore";
import { useToasts } from "../src/shell/toasts";
import { resetModalStack } from "../src/shell/modalStack";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let app: HTMLDivElement | null = null;

function render() {
  container = document.createElement("div");
  app = document.createElement("div");
  app.className = "folio-app";
  const anchor = document.createElement("button");
  anchor.dataset.tour = "library-search";
  anchor.textContent = "Search";
  app.appendChild(anchor);
  for (const name of ["nav-collections", "nav-notes", "nav-settings", "import"]) {
    const el = document.createElement("button");
    el.dataset.tour = name;
    el.textContent = name;
    app.appendChild(el);
  }
  container.appendChild(app);
  document.body.appendChild(container);

  const host = document.createElement("div");
  container.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Tour />));
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label)
  );
  if (!found) throw new Error(`button ${label} not found`);
  return found;
}

beforeEach(() => {
  memory.clear();
  resetModalStack();
  useToasts.setState({ toast: null });
  useOnboarding.setState({ stage: "tour", tourOpen: true });
  useRouteStore.setState({ route: "library", readerRequest: null, readerOrigin: null });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  app = null;
});

describe("welcome tour", () => {
  it("dismisses on Escape for this session only", () => {
    render();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });

    expect(useOnboarding.getState().stage).toBe("tour");
    expect(useOnboarding.getState().tourOpen).toBe(false);
    expect(memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
    expect(useToasts.getState().toast?.tone).toBe("info");
  });

  it("completes only from the deliberate finish actions", () => {
    render();

    act(() => {
      button("Skip tour").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useOnboarding.getState().stage).toBe("done");
    expect(useOnboarding.getState().tourOpen).toBe(false);
    expect(memory.get(TOUR_COMPLETE_KEY)).toBe("1");
    expect(useRouteStore.getState().route).toBe("library");
  });

  it("walks routes and spotlights the matching control", () => {
    render();

    act(() => {
      button("Next").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useRouteStore.getState().route).toBe("library");

    act(() => {
      button("Next").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useRouteStore.getState().route).toBe("collections");
    expect(
      container!.querySelector(".folio-tour__spotlight")
    ).not.toBeNull();
    expect(
      container!.querySelector(".folio-tour__card--anchored")
    ).not.toBeNull();
  });

  it("marks the shell inert while open and restores it afterwards", () => {
    render();
    expect(app!.hasAttribute("inert")).toBe(true);
    expect(app!.getAttribute("aria-hidden")).toBe("true");

    act(() => root?.unmount());
    root = null;

    expect(app!.hasAttribute("inert")).toBe(false);
    expect(app!.hasAttribute("aria-hidden")).toBe(false);
  });
});
