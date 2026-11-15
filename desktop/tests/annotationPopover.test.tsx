// AnnotationPopover (R5): quote + note display, colour swatches with active
// state, edit-note / copy / delete actions, Escape and outside dismissal.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { AnnotationPopover } from "../src/components/AnnotationPopover";
import type { Annotation } from "../src/model/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "h1",
    docId: "d1",
    chapterId: null,
    quote: "A highlighted sentence",
    prefix: "",
    suffix: "",
    location: "ch1.xhtml?p=0.3",
    kind: "highlight",
    color: "blue",
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function render(props: Parameters<typeof AnnotationPopover>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<AnnotationPopover {...props} />);
  });
}

function swatch(label: string): HTMLButtonElement {
  const el = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".folio-annotation-popover__swatches button"),
  ).find((b) => b.getAttribute("aria-label")?.includes(label));
  expect(el).toBeDefined();
  return el!;
}

describe("AnnotationPopover (R5)", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders quote, note, swatches and the three actions", () => {
    render({
      annotation: annotation({ note: "Why this matters" }),
      x: 100,
      y: 200,
      onClose: () => {},
      onChangeColor: () => {},
      onEditNote: () => {},
      onDelete: () => {},
      onCopy: () => {},
    });
    expect(document.querySelector(".folio-annotation-popover[role='dialog']")).not.toBeNull();
    expect(document.querySelector(".folio-annotation-popover__quote")?.textContent).toBe(
      "A highlighted sentence",
    );
    expect(document.querySelector(".folio-annotation-popover__note")?.textContent).toBe(
      "Why this matters",
    );
    const actions = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".folio-annotation-popover__action"),
    ).map((b) => b.textContent);
    expect(actions[0]).toContain("Edit note");
    expect(actions[1]).toContain("Copy");
    expect(actions[2]).toContain("Delete");
    expect(document.querySelectorAll(".folio-annotation-popover__swatches button")).toHaveLength(4);
  });

  it("marks the active colour and reports changes", () => {
    const onChangeColor = vi.fn();
    render({
      annotation: annotation({ color: "blue" }),
      x: 100,
      y: 200,
      onClose: () => {},
      onChangeColor,
      onEditNote: () => {},
      onDelete: () => {},
      onCopy: () => {},
    });
    expect(swatch("Blue").getAttribute("aria-pressed")).toBe("true");
    expect(swatch("Yellow").getAttribute("aria-pressed")).toBe("false");

    act(() => {
      swatch("Pink").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChangeColor).toHaveBeenCalledWith("pink");
    expect(swatch("Pink").getAttribute("aria-pressed")).toBe("true");
    expect(swatch("Blue").getAttribute("aria-pressed")).toBe("false");
  });

  it("hides the note line when there is none and offers Add note", () => {
    render({
      annotation: annotation(),
      x: 100,
      y: 200,
      onClose: () => {},
      onChangeColor: () => {},
      onEditNote: () => {},
      onDelete: () => {},
      onCopy: () => {},
    });
    expect(document.querySelector(".folio-annotation-popover__note")).toBeNull();
    const first = document.querySelector<HTMLButtonElement>(".folio-annotation-popover__action")!;
    expect(first.textContent).toContain("Add note");
  });

  it("dismisses on an outside press", () => {
    const onClose = vi.fn();
    render({
      annotation: annotation(),
      x: 100,
      y: 200,
      onClose,
      onChangeColor: () => {},
      onEditNote: () => {},
      onDelete: () => {},
      onCopy: () => {},
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open on a press inside the popover", () => {
    const onClose = vi.fn();
    render({
      annotation: annotation(),
      x: 100,
      y: 200,
      onClose,
      onChangeColor: () => {},
      onEditNote: () => {},
      onDelete: () => {},
      onCopy: () => {},
    });
    act(() => {
      document
        .querySelector(".folio-annotation-popover")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses on Escape", () => {
    const onClose = vi.fn();
    render({
      annotation: annotation(),
      x: 100,
      y: 200,
      onClose,
      onChangeColor: () => {},
      onEditNote: () => {},
      onDelete: () => {},
      onCopy: () => {},
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
