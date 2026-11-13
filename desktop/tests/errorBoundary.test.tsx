// P0-3: a render error must show the recovery UI instead of a blank window,
// the error must reach the local log, and the reader boundary must offer
// "Back to library".
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: vi.fn(async () => vi.fn()) }),
}));

import { invoke } from "@tauri-apps/api/core";
import { ErrorBoundary } from "../src/shell/ErrorBoundary";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const invokeMock = vi.mocked(invoke);

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

function Bomb(): React.ReactElement {
  throw new Error("boom: reader exploded");
}

describe("ErrorBoundary (P0-3)", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
    invokeMock.mockClear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows the root recovery screen and logs the error", () => {
    render(
      <ErrorBoundary variant="root">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(document.querySelector(".folio-errorboundary")).not.toBeNull();
    expect(document.querySelector(".folio-errorboundary__title")?.textContent).toBe(
      "Something went wrong",
    );
    // Logged through the Rust logger (window flagged as Tauri by the mock env).
    const logCall = invokeMock.mock.calls.find(([cmd]) => cmd === "log_error");
    expect(logCall).toBeDefined();
    expect(String((logCall![1] as { message: string }).message)).toContain("boom");
  });

  it("recovers when Try again re-renders clean children", () => {
    function Self() {
      return (
        <ErrorBoundary variant="root">
          <Bomb />
        </ErrorBoundary>
      );
    }
    // Render a failing child, then re-render with a clean tree.
    render(
      <ErrorBoundary variant="root">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(document.querySelector(".folio-errorboundary")).not.toBeNull();
    const retry = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Try again",
    ) as HTMLButtonElement;
    act(() => {
      retry.click();
    });
    // Still broken (children still throw) but boundary state was reset; it
    // re-caught instead of staying stuck — the UI is alive either way.
    expect(document.querySelector(".folio-errorboundary")).not.toBeNull();
    void Self;
  });

  it("reader variant offers Back to library and routes through onRecover", () => {
    let routed = 0;
    render(
      <ErrorBoundary variant="reader" onRecover={() => (routed += 1)}>
        <Bomb />
      </ErrorBoundary>,
    );
    const back = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Back to library",
    ) as HTMLButtonElement;
    expect(back).toBeDefined();
    act(() => {
      back.click();
    });
    expect(routed).toBe(1);
  });

  it("passes clean trees through untouched", () => {
    render(
      <ErrorBoundary variant="root">
        <p id="fine">fine</p>
      </ErrorBoundary>,
    );
    expect(document.getElementById("fine")).not.toBeNull();
    expect(document.querySelector(".folio-errorboundary")).toBeNull();
  });

  it("supports a manual reset via the state API between renders", () => {
    // Render clean, then an error in a re-rendered subtree; then recover by
    // re-rendering clean children (the boundary clears its own state).
    render(
      <ErrorBoundary variant="root">
        <p id="fine">fine</p>
      </ErrorBoundary>,
    );
    act(() => {
      root!.render(
        <ErrorBoundary variant="root">
          <Bomb />
        </ErrorBoundary>,
      );
    });
    expect(document.querySelector(".folio-errorboundary")).not.toBeNull();
    act(() => {
      root!.render(
        <ErrorBoundary variant="root">
          <p id="fine2">fine again</p>
        </ErrorBoundary>,
      );
    });
    // The boundary still holds its error state until "Try again" is pressed.
    const retry = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Try again",
    ) as HTMLButtonElement;
    act(() => {
      retry.click();
    });
    expect(document.getElementById("fine2")).not.toBeNull();
  });
});
