// P0-2: FolioPanel/FolioDialog must not re-run their focus logic when a
// parent re-renders with a new inline `onClose` callback. The in-book search
// input (data-autofocus) must keep focus across parent re-renders.
import { describe, it, expect, beforeEach } from "vitest";
import { useState, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { FolioPanel } from "../src/components/FolioPanel";
import { FolioDialog } from "../src/components/FolioDialog";

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

function rerender(ui: React.ReactElement) {
  act(() => {
    root!.render(ui);
  });
}

/** Parent whose inline onClose is a new function on every render. */
function PanelHost({ withInput }: { withInput: boolean }) {
  const [open, setOpen] = useState(true);
  // Rebuilt on every render — the regression trigger.
  const onClose = () => setOpen(false);
  return (
    <>
      <button type="button" id="outside">
        outside
      </button>
      <FolioPanel open={open} onClose={onClose} title="Test panel">
        {withInput ? <input data-autofocus aria-label="Search text in book" /> : <p>content</p>}
      </FolioPanel>
    </>
  );
}

function DialogHost() {
  const [open, setOpen] = useState(true);
  const onClose = () => setOpen(false);
  return (
    <FolioDialog open={open} onClose={onClose} title="Test dialog">
      <input data-autofocus aria-label="Draft" />
    </FolioDialog>
  );
}

describe("FolioPanel / FolioDialog focus stability (P0-2)", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("keeps focus on the panel input when the parent re-renders", () => {
    render(<PanelHost withInput />);
    const input = document.querySelector("input[data-autofocus]") as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    rerender(<PanelHost withInput />);
    rerender(<PanelHost withInput />);

    expect(document.activeElement).toBe(input);
  });

  it("keeps focus on the dialog input when the parent re-renders", () => {
    render(<DialogHost />);
    const input = document.querySelector("input[data-autofocus]") as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    rerender(<DialogHost />);
    expect(document.activeElement).toBe(input);
  });

  it("falls back to the first focusable element when no data-autofocus exists", () => {
    render(<PanelHost withInput={false} />);
    const closeBtn = document.querySelector(
      'button[aria-label="Close panel"]',
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(closeBtn);

    rerender(<PanelHost withInput={false} />);
    expect(document.activeElement).toBe(closeBtn);
  });

  it("restores focus to the previously focused element when the panel closes", () => {
    let setOpenRef: ((open: boolean) => void) | null = null;
    function ClosableHost({ initialOpen }: { initialOpen: boolean }) {
      const [open, setOpen] = useState(initialOpen);
      useEffect(() => {
        setOpenRef = setOpen;
      }, []);
      return (
        <>
          <button type="button" id="origin">
            origin
          </button>
          <FolioPanel open={open} onClose={() => setOpen(false)} title="Closable">
            <input data-autofocus aria-label="Field" />
          </FolioPanel>
        </>
      );
    }
    // Start closed, focus a sibling, then open: the panel must remember it.
    render(<ClosableHost initialOpen={false} />);
    const origin = document.getElementById("origin") as HTMLButtonElement;
    act(() => {
      origin.focus();
    });
    act(() => {
      setOpenRef?.(true);
    });
    expect(document.activeElement).toBe(document.querySelector("input[data-autofocus]"));

    const closeBtn = document.querySelector(
      'button[aria-label="Close panel"]',
    ) as HTMLButtonElement;
    act(() => {
      closeBtn.click();
    });
    expect(document.querySelector(".folio-panel")).toBeNull();
    expect(document.activeElement).toBe(origin);
  });

  it("invokes the latest onClose when Escape is pressed after re-renders", () => {
    let closed = 0;
    function Host() {
      const [open, setOpen] = useState(true);
      const onClose = () => {
        closed += 1;
        setOpen(false);
      };
      return (
        <FolioPanel open={open} onClose={onClose} title="Escape target">
          <p>content</p>
        </FolioPanel>
      );
    }
    render(<Host />);
    rerender(<Host />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(closed).toBe(1);
    expect(document.querySelector(".folio-panel")).toBeNull();
  });
});
