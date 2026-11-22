// The PDF appearance panel must contain only fixed-layout controls; EPUB
// typography and reading-width settings belong to the reflowable panel.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { PdfAppearancePanel } from "../src/components/PdfAppearancePanel";
import { DEFAULT_PDF_READER_PREFS } from "../src/model/formatPrefs";
import type { PdfReaderPrefs } from "../src/model/formatPrefs";

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

function buttonWithText(text: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.trim().includes(text),
  ) as HTMLButtonElement | undefined;
  if (!found) throw new Error(`button with text ${text} not found`);
  return found;
}

function props(overrides: Partial<React.ComponentProps<typeof PdfAppearancePanel>> = {}) {
  return {
    open: true,
    prefs: { ...DEFAULT_PDF_READER_PREFS },
    zoom: "fit-width" as const,
    onClose: () => {},
    onChange: (_next: PdfReaderPrefs) => {},
    onReset: () => {},
    onZoomBy: (_dir: 1 | -1) => {},
    onZoomMode: (_mode: "fit-width" | "fit-page") => {},
    onZoomActual: () => {},
    onGoPage: (_page: number) => {},
    ...overrides,
  };
}

describe("PdfAppearancePanel", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("shows fixed-layout controls and no EPUB typography or reading width", () => {
    render(<PdfAppearancePanel {...props()} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Page presentation");
    expect(text).toContain("Page arrangement");
    expect(text).toContain("Page rotation");
    expect(text).toContain("Surrounding background");
    expect(text).toContain("Actual size");
    expect(text).toContain("Hand / pan");
    expect(text).not.toContain("Typeface");
    expect(text).not.toContain("Line spacing");
    expect(text).not.toContain("Reading width");
    expect(text).not.toContain("Paragraph spacing");
  });

  it("patches facing-page arrangement through the PDF preference model", () => {
    let next: PdfReaderPrefs | null = null;
    render(<PdfAppearancePanel {...props({ onChange: (p) => (next = p) })} />);
    act(() => {
      buttonWithText("Facing pages").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((next as PdfReaderPrefs | null)?.spread).toBe("both");
  });

  it("patches page presentation and rotation", () => {
    const changes: PdfReaderPrefs[] = [];
    render(<PdfAppearancePanel {...props({ onChange: (p) => changes.push(p) })} />);
    act(() => {
      buttonWithText("Night").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(changes[0].presentation).toBe("night");
    act(() => {
      buttonWithText("90°").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(changes[1].rotation).toBe(90);
  });

  it("wires actual size, page navigation and reset", () => {
    const onZoomActual = vi.fn();
    const onGoPage = vi.fn();
    const onReset = vi.fn();
    render(
      <PdfAppearancePanel
        {...props({ onZoomActual, onGoPage, onReset, pageInfo: { page: 3, pageCount: 10 } })}
      />,
    );
    act(() => {
      buttonWithText("Actual size").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onZoomActual).toHaveBeenCalledTimes(1);
    const input = document.querySelector("#folio-pdf-page-number") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "7");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onGoPage).toHaveBeenCalledWith(7);
    act(() => {
      buttonWithText("Reset PDF appearance").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
