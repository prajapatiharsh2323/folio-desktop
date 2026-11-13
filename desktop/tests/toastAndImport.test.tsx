import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { importFileMock } = vi.hoisted(() => ({ importFileMock: vi.fn() }));

vi.mock("../src/import/importService", () => ({
  importFile: importFileMock,
}));

import { ToastHost } from "../src/components/ToastHost";
import { useLibraryUi } from "../src/store/libraryUi";
import { useToasts } from "../src/shell/toasts";

function resetUi() {
  useToasts.setState({ toast: null });
  useLibraryUi.setState({
    rows: [],
    loading: false,
    error: null,
    recovery: null,
    recoveryDialogOpen: false,
    duplicate: null,
  });
}

function file(name: string) {
  return { name, bytes: new Uint8Array([1]) };
}

describe("import queue", () => {
  beforeEach(() => {
    resetUi();
    importFileMock.mockReset();
  });

  it("serialises overlapping batches instead of interleaving them", async () => {
    let running = 0;
    let maxRunning = 0;
    importFileMock.mockImplementation(async (_lm, name: string) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { status: "imported", title: name };
    });

    await Promise.all([
      useLibraryUi.getState().importPicked([file("a.epub")]),
      useLibraryUi.getState().importPicked([file("b.epub")]),
    ]);

    expect(maxRunning).toBe(1);
    expect(importFileMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed import visible and still refreshes", async () => {
    importFileMock.mockRejectedValue(new Error("disk full"));

    await useLibraryUi.getState().importPicked([file("broken.epub")]);

    const toast = useToasts.getState().toast;
    expect(toast?.tone).toBe("error");
    expect(toast?.text).toBe("Import failed");
    expect(toast?.details?.join(" ")).toContain("disk full");
    expect(useLibraryUi.getState().loading).toBe(false);
  });

  it("summarises a mixed batch once", async () => {
    const statuses: Record<string, unknown> = {
      "a.epub": { status: "imported", title: "A" },
      "b.epub": { status: "imported", title: "B" },
      "c.epub": { status: "skipped", title: "C" },
      "bad.epub": { status: "refused", error: "Unsupported file" },
    };
    importFileMock.mockImplementation(async (_lm, name: string) => statuses[name]);

    await useLibraryUi
      .getState()
      .importPicked([file("a.epub"), file("b.epub"), file("c.epub"), file("bad.epub")]);

    const toast = useToasts.getState().toast;
    expect(toast?.tone).toBe("error");
    expect(toast?.text).toBe("Imported 2, skipped 1, 1 failed");
    expect(toast?.details?.join(" ")).toContain("bad.epub");
  });
});

describe("toast host", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    vi.useRealTimers();
  });

  function render() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<ToastHost />));
  }

  beforeEach(resetUi);

  it("dismisses a success message after four seconds", () => {
    vi.useFakeTimers();
    useToasts.getState().push({ tone: "success", text: "Imported “A”" });
    render();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(useToasts.getState().toast).toBeNull();
  });

  it("keeps an error until it is dismissed", () => {
    vi.useFakeTimers();
    useToasts.getState().push({ tone: "error", text: "Import failed" });
    render();

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(useToasts.getState().toast?.tone).toBe("error");

    const close = container.querySelector<HTMLButtonElement>(".folio-snackbar__close");
    expect(close).not.toBeNull();
    act(() => {
      close!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useToasts.getState().toast).toBeNull();
  });
});
