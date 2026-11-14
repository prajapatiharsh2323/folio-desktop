// FootnotePopover (R4 2.2b): sanitized body renders inline, dismissed by
// Escape, an outside press, or the close button. It never navigates.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { FootnotePopover } from "../src/components/FootnotePopover";
import type { NoterefActivation } from "../src/reader/ReaderEngine";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function activation(overrides: Partial<NoterefActivation> = {}): NoterefActivation {
  return {
    x: 100,
    y: 200,
    html: "<p>A <em>carefully</em> footnoted claim.</p>",
    text: "A carefully footnoted claim.",
    source: "OEBPS/notes.xhtml#fn1",
    ...overrides,
  };
}

function render(activationIn: NoterefActivation, onClose: () => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<FootnotePopover activation={activationIn} onClose={onClose} />);
  });
}

describe("FootnotePopover (R4 2.2b)", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders the body markup and close affordance", () => {
    render(activation(), () => {});
    const pop = document.querySelector(".folio-footnote-popover[role='dialog']");
    expect(pop).not.toBeNull();
    expect(pop!.getAttribute("aria-label")).toBe("Footnote");
    const em = pop!.querySelector("em");
    expect(em?.textContent).toBe("carefully");
    expect(document.querySelector(".folio-footnote-popover__close")).not.toBeNull();
  });

  it("the close button dismisses", () => {
    const onClose = vi.fn();
    render(activation(), onClose);
    const close = document.querySelector<HTMLButtonElement>(".folio-footnote-popover__close")!;
    act(() => {
      close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape dismisses", () => {
    const onClose = vi.fn();
    render(activation(), onClose);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a press outside the popover dismisses", () => {
    const onClose = vi.fn();
    render(activation(), onClose);
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a press inside the popover does not dismiss", () => {
    const onClose = vi.fn();
    render(activation(), onClose);
    const body = document.querySelector(".folio-footnote-popover__body")!;
    act(() => {
      body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("positions beside the reference, clamped to the viewport", () => {
    const win = window;
    const origInnerWidth = win.innerWidth;
    Object.defineProperty(win, "innerWidth", { configurable: true, value: 400 });
    Object.defineProperty(win, "innerHeight", { configurable: true, value: 500 });
    try {
      // x=390 would overflow a 400px viewport with a 340px popover.
      render(activation({ x: 390, y: 40 }), () => {});
      const pop = document.querySelector<HTMLElement>(".folio-footnote-popover")!;
      expect(pop.style.left).toBe("48px"); // 400 - 340 - 12
      expect(pop.style.top).toBe("16px"); // max(12, 40 - 24)
    } finally {
      Object.defineProperty(win, "innerWidth", { configurable: true, value: origInnerWidth });
      Object.defineProperty(win, "innerHeight", { configurable: true, value: 768 });
    }
  });
});
