import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { DecorationPopover } from "../src/components/DecorationPopover";

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

function items(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll(".folio-pdf-decor-popover [role='menuitem']"),
  ) as HTMLButtonElement[];
}

describe("DecorationPopover (R5 highlight popover, §12)", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders the note and remove actions", () => {
    render(
      <DecorationPopover
        x={40}
        y={120}
        hasNote={false}
        onEditNote={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    const labels = items().map((b) => b.textContent);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain("Add note");
    expect(labels[1]).toContain("Remove highlight");
  });

  it("says Edit note when the highlight already has one", () => {
    render(
      <DecorationPopover
        x={40}
        y={120}
        hasNote
        onEditNote={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(items()[0].textContent).toContain("Edit note");
  });

  it("closes and runs the chosen action", () => {
    let edited = 0;
    let removed = 0;
    let closed = 0;
    render(
      <DecorationPopover
        x={40}
        y={120}
        hasNote={false}
        onEditNote={() => {
          edited += 1;
        }}
        onRemove={() => {
          removed += 1;
        }}
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    act(() => {
      items()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(edited).toBe(1);
    expect(removed).toBe(0);
    expect(closed).toBe(1);

    render(
      <DecorationPopover
        x={40}
        y={120}
        hasNote={false}
        onEditNote={() => {}}
        onRemove={() => {
          removed += 1;
        }}
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    act(() => {
      items()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(removed).toBe(1);
    expect(closed).toBe(2);
  });

  it("dismisses on Escape", () => {
    let closed = 0;
    render(
      <DecorationPopover
        x={40}
        y={120}
        hasNote={false}
        onEditNote={() => {}}
        onRemove={() => {}}
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(closed).toBe(1);
  });

  it("dismisses on a mousedown outside the popover", () => {
    let closed = 0;
    render(
      <DecorationPopover
        x={40}
        y={120}
        hasNote={false}
        onEditNote={() => {}}
        onRemove={() => {}}
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(closed).toBe(1);
  });
});
