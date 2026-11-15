// Toast stack (R14): at most three messages, keyed replacement, errors kept
// over auto-dismissable tones, and the host pausing timers while hovered.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { ToastHost } from "../src/components/ToastHost";
import { useToasts } from "../src/shell/toasts";

describe("toast store stack (R14)", () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
  });

  it("stacks messages newest last", () => {
    useToasts.getState().push({ tone: "info", text: "one" });
    useToasts.getState().push({ tone: "success", text: "two" });
    expect(useToasts.getState().toasts.map((t) => t.text)).toEqual(["one", "two"]);
  });

  it("caps the stack at three, evicting the oldest non-error", () => {
    useToasts.getState().push({ tone: "success", text: "s1" });
    useToasts.getState().push({ tone: "error", text: "e2" });
    useToasts.getState().push({ tone: "info", text: "i3" });
    useToasts.getState().push({ tone: "success", text: "s4" });
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(3);
    expect(toasts.map((t) => t.text)).toEqual(["e2", "i3", "s4"]);
  });

  it("keeps errors visible: a success never evicts an error while a non-error exists", () => {
    useToasts.getState().push({ tone: "error", text: "e1" });
    useToasts.getState().push({ tone: "error", text: "e2" });
    useToasts.getState().push({ tone: "error", text: "e3" });
    useToasts.getState().push({ tone: "success", text: "s4" });
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(3);
    // Every toast is an error except the newcomer, so the oldest falls off.
    expect(toasts.map((t) => t.text)).toEqual(["e2", "e3", "s4"]);
  });

  it("replaces a keyed toast in place instead of stacking a duplicate", () => {
    useToasts.getState().push({ tone: "info", text: "first", key: "nav" });
    useToasts.getState().push({ tone: "success", text: "other" });
    useToasts.getState().push({ tone: "info", text: "second", key: "nav" });
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(2);
    expect(toasts[0].text).toBe("second"); // same slot, updated in place
    expect(toasts[1].text).toBe("other");
  });

  it("dismiss(id) removes exactly that toast; dismiss() clears the stack", () => {
    const a = useToasts.getState().push({ tone: "info", text: "a" });
    useToasts.getState().push({ tone: "info", text: "b" });
    useToasts.getState().dismiss(a);
    expect(useToasts.getState().toasts.map((t) => t.text)).toEqual(["b"]);
    useToasts.getState().dismiss();
    expect(useToasts.getState().toasts).toEqual([]);
  });
});

describe("toast host stack rendering + pause (R14)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  function render() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<ToastHost />));
  }

  function stack(): HTMLElement {
    const el = container.querySelector<HTMLElement>(".folio-toast-stack");
    expect(el).not.toBeNull();
    return el!;
  }

  beforeEach(() => {
    useToasts.setState({ toasts: [] });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    vi.useRealTimers();
  });

  it("renders every stacked message with per-tone roles", () => {
    useToasts.getState().push({ tone: "error", text: "boom" });
    useToasts.getState().push({ tone: "info", text: "saved" });
    render();

    const bars = container.querySelectorAll(".folio-snackbar");
    expect(bars).toHaveLength(2);
    expect(bars[0].getAttribute("role")).toBe("alert");
    expect(bars[0].getAttribute("aria-live")).toBe("assertive");
    expect(bars[1].getAttribute("role")).toBe("status");
    expect(bars[1].getAttribute("aria-live")).toBe("polite");
  });

  it("auto-dismisses success/info but keeps errors", () => {
    vi.useFakeTimers();
    useToasts.getState().push({ tone: "success", text: "done" });
    useToasts.getState().push({ tone: "error", text: "failed" });
    render();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(useToasts.getState().toasts.map((t) => t.text)).toEqual(["failed"]);
  });

  it("hovering the stack pauses timers; leaving restarts the full window", () => {
    vi.useFakeTimers();
    useToasts.getState().push({ tone: "info", text: "hover me" });
    render();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => {
      stack().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(useToasts.getState().toasts).toHaveLength(1); // paused

    act(() => {
      stack().dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(useToasts.getState().toasts).toEqual([]); // fresh 4 s after resume
  });

  it("focusing a control inside the stack pauses timers too", () => {
    vi.useFakeTimers();
    useToasts.getState().push({
      tone: "info",
      text: "with action",
      action: { label: "Undo", run: () => {} },
    });
    render();

    act(() => {
      stack().querySelector<HTMLButtonElement>(".folio-snackbar__action")!.focus();
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it("a replaced keyed toast restarts its auto-dismiss window", () => {
    vi.useFakeTimers();
    useToasts.getState().push({ tone: "info", text: "first", key: "nav" });
    render();

    act(() => {
      vi.advanceTimersByTime(3000);
      useToasts.getState().push({ tone: "info", text: "second", key: "nav" });
    });

    act(() => {
      vi.advanceTimersByTime(3900);
    });
    expect(useToasts.getState().toasts.map((t) => t.text)).toEqual(["second"]);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(useToasts.getState().toasts).toEqual([]);
  });
});
