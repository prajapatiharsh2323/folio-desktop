// Accessibility unit tests for the component-level fixes from the FT-006
// audit (docs/development/audits/ui-ux/A-20261031-01-accessibility.md):
// dialog focus restore (A-UI-20261031-01) and chip radiogroup semantics.
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { FolioDialog } from "../src/components/FolioDialog";
import { FolioChip } from "../src/components/FolioChip";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(ui: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const r = createRoot(container);
  root = r;
  act(() => r.render(ui));
}

function unmount() {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  container = null;
  root = null;
}

/** Opener button + controlled FolioDialog, like the settings screens. */
function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      <FolioDialog open={open} onClose={() => setOpen(false)} title="Confirm">
        <p>Body</p>
      </FolioDialog>
    </>
  );
}

describe("dialog focus restore (A-UI-20261031-01)", () => {
  afterEach(unmount);

  it("moves focus into the dialog on open and back to the opener on close", () => {
    mount(<DialogHarness />);
    const opener = document.getElementById("opener")! as HTMLButtonElement;

    // Opening: focus must land inside the dialog (focus-trapped surface).
    act(() => {
      opener.focus();
    });
    expect(document.activeElement).toBe(opener);
    act(() => {
      opener.click();
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(opener);

    // Closing: focus must return to the last focused element *outside* the
    // dialog (captured before the dialog moved focus — the fix under test).
    const closeBtn = document.querySelector('button[aria-label="Close dialog"]')!;
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.activeElement).toBe(opener);
  });
});

describe("accessible chip semantics (03 §7)", () => {
  afterEach(unmount);

  it("default chip is a toggle button (aria-pressed), selected state only", () => {
    mount(
      <>
        <FolioChip selected>A</FolioChip>
        <FolioChip>B</FolioChip>
      </>
    );
    const chips = Array.from(container!.querySelectorAll("button.folio-chip"));
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    expect(chips[1].getAttribute("aria-pressed")).toBe("false");
    for (const chip of chips) {
      expect(chip.getAttribute("role")).toBeNull();
      expect(chip.getAttribute("aria-checked")).toBeNull();
    }
  });

  it("asRadio chip is a radio with aria-checked and no clashing aria-pressed", () => {
    mount(
      <div role="radiogroup" aria-label="Layout">
        <FolioChip selected asRadio>
          Paginated
        </FolioChip>
        <FolioChip asRadio>
          Scrolled
        </FolioChip>
      </div>
    );
    const group = container!.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("Layout");
    const radios = Array.from(group.querySelectorAll('[role="radio"]'));
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio.getAttribute("aria-pressed")).toBeNull();
    }
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[1].getAttribute("aria-checked")).toBe("false");
  });
});
