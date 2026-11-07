import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { AppearancePanel } from "../src/components/AppearancePanel";
import { DEFAULT_READING_PREFS } from "../src/model/defaults";
import type { ReadingPrefs } from "../src/model/types";

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

describe("AppearancePanel", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders quick font size steppers (A- and A+)", () => {
    let nextPrefs: ReadingPrefs | null = null;
    render(
      <AppearancePanel
        open={true}
        prefs={{ ...DEFAULT_READING_PREFS, fontSize: 18 }}
        onClose={() => {}}
        onChange={(p) => {
          nextPrefs = p;
        }}
        onReset={() => {}}
      />
    );

    const decreaseBtn = document.querySelector("[aria-label='Decrease text size']") as HTMLButtonElement;
    const increaseBtn = document.querySelector("[aria-label='Increase text size']") as HTMLButtonElement;
    expect(decreaseBtn).not.toBeNull();
    expect(increaseBtn).not.toBeNull();

    act(() => {
      decreaseBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(nextPrefs).not.toBeNull();
    expect((nextPrefs as ReadingPrefs | null)?.fontSize).toBe(17);

    act(() => {
      increaseBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((nextPrefs as ReadingPrefs | null)?.fontSize).toBe(19);
  });

  it("renders quick reading width presets (Compact, Standard, Wide, Full width)", () => {
    let nextPrefs: ReadingPrefs | null = null;
    render(
      <AppearancePanel
        open={true}
        prefs={{ ...DEFAULT_READING_PREFS, maxWidth: 880 }}
        onClose={() => {}}
        onChange={(p) => {
          nextPrefs = p;
        }}
        onReset={() => {}}
      />
    );

    const presetChips = Array.from(document.querySelectorAll(".folio-appearance__preset-chip")) as HTMLButtonElement[];
    expect(presetChips.length).toBe(4);
    expect(presetChips[0].textContent).toContain("Compact");
    expect(presetChips[1].textContent).toContain("Standard");
    expect(presetChips[2].textContent).toContain("Wide");
    expect(presetChips[3].textContent).toContain("Full width");

    expect(presetChips[1].className).toContain("is-active");

    act(() => {
      presetChips[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(nextPrefs).not.toBeNull();
    expect((nextPrefs as ReadingPrefs | null)?.maxWidth).toBe(640);
  });

  it("renders live typography preview with sample text and active font styles", () => {
    render(
      <AppearancePanel
        open={true}
        prefs={{ ...DEFAULT_READING_PREFS, fontSize: 20, fontFamily: "serif" }}
        onClose={() => {}}
        onChange={() => {}}
        onReset={() => {}}
      />
    );

    const preview = document.querySelector(".folio-typography-preview") as HTMLElement;
    expect(preview).not.toBeNull();
    expect(preview.textContent).toContain("The quick brown fox jumps over the lazy dog");
    expect(preview.style.fontSize).toBe("20px");
    expect(preview.style.fontFamily).toContain("Iowan Old Style");
  });

  it("calls onReset when 'Reset to defaults' is clicked", () => {
    let resetCalled = false;
    render(
      <AppearancePanel
        open={true}
        prefs={DEFAULT_READING_PREFS}
        onClose={() => {}}
        onChange={() => {}}
        onReset={() => {
          resetCalled = true;
        }}
      />
    );

    const resetBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Reset to defaults")
    ) as HTMLButtonElement;
    expect(resetBtn).not.toBeNull();

    act(() => {
      resetBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(resetCalled).toBe(true);
  });

  it("renders text alignment and hyphenation controls and allows toggling", () => {
    let nextPrefs: ReadingPrefs | null = null;
    render(
      <AppearancePanel
        open={true}
        prefs={{ ...DEFAULT_READING_PREFS, justify: false, hyphenate: false }}
        onClose={() => {}}
        onChange={(p) => {
          nextPrefs = p;
        }}
        onReset={() => {}}
      />
    );

    // Check quick alignment chip
    const justifyQuickBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Justify"
    ) as HTMLButtonElement;
    expect(justifyQuickBtn).not.toBeNull();

    act(() => {
      justifyQuickBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(nextPrefs).not.toBeNull();
    expect((nextPrefs as ReadingPrefs | null)?.justify).toBe(true);

    // Check alignment switch in section
    const justifySwitch = document.querySelector("[aria-label='Justify text']") as HTMLButtonElement;
    expect(justifySwitch).not.toBeNull();

    act(() => {
      justifySwitch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((nextPrefs as ReadingPrefs | null)?.justify).toBe(true);

    // Check hyphenate switch
    const hyphenateSwitch = document.querySelector("[aria-label='Hyphenate']") as HTMLButtonElement;
    expect(hyphenateSwitch).not.toBeNull();

    act(() => {
      hyphenateSwitch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((nextPrefs as ReadingPrefs | null)?.hyphenate).toBe(true);
  });
});
