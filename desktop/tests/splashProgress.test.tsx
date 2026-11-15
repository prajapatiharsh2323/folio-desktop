// R12: the splash shows live open progress — an indeterminate bar with an
// "Unpacking book…" label while the archive is walked, a determinate percent
// while pages are prepared — and plain loading state without progress.
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { ReaderSplash, type SplashProgress } from "../src/components/ReaderSplash";

describe("ReaderSplash open progress (R12)", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  function renderSplash(
    progress: SplashProgress | null = null,
    phase: "loading" | "error" = "loading",
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <ReaderSplash
          phase={phase}
          title="Moby"
          author={null}
          coverUrl={null}
          tint={0}
          progress={progress}
          errorMessage={phase === "error" ? "bad file" : null}
          onRetry={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("shows no progress bar before the engine reports anything", () => {
    renderSplash(null);
    expect(document.querySelector(".folio-reader-splash__progress")).toBeNull();
    expect(document.querySelector(".folio-reader-spinner")).not.toBeNull();
    act(() => root!.unmount());
  });

  it("shows an indeterminate Unpacking bar for the unpack stage", () => {
    renderSplash({ stage: "unpack", fraction: null });
    const bar = document.querySelector(".folio-reader-splash__progressbar");
    expect(bar?.className).toContain("is-indeterminate");
    expect(bar?.getAttribute("aria-valuenow")).toBeNull();
    expect(document.querySelector(".folio-reader-splash__progresslabel")?.textContent).toBe(
      "Unpacking book…",
    );
    act(() => root!.unmount());
  });

  it("shows a determinate Preparing-pages percent", () => {
    renderSplash({ stage: "prepare", fraction: 0.5 });
    const bar = document.querySelector(".folio-reader-splash__progressbar");
    expect(bar?.className).not.toContain("is-indeterminate");
    expect(bar?.getAttribute("aria-valuenow")).toBe("50");
    expect(document.querySelector(".folio-reader-splash__progresslabel")?.textContent).toBe(
      "Preparing pages… 50%",
    );
    act(() => root!.unmount());
  });

  it("keeps the progress bar out of the error state", () => {
    renderSplash({ stage: "prepare", fraction: 0.2 }, "error");
    expect(document.querySelector(".folio-reader-splash__progress")).toBeNull();
    expect(document.querySelector(".folio-reader-splash__error")).not.toBeNull();
    act(() => root!.unmount());
  });
});
