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
      />,
    );

    const decreaseBtn = document.querySelector(
      "[aria-label='Decrease text size']",
    ) as HTMLButtonElement;
    const increaseBtn = document.querySelector(
      "[aria-label='Increase text size']",
    ) as HTMLButtonElement;
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
      />,
    );

    const presetChips = Array.from(
      document.querySelectorAll(".folio-appearance__preset-chip"),
    ) as HTMLButtonElement[];
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
      />,
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
      />,
    );

    const resetBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Reset to defaults"),
    ) as HTMLButtonElement;
    expect(resetBtn).not.toBeNull();

    act(() => {
      resetBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(resetCalled).toBe(true);
  });

  it("keeps one control per preference for alignment and hyphenation", () => {
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
      />,
    );

    // Alignment/hyphenation now live only in Typography, not in Quick adjustments.
    expect(document.querySelectorAll("[aria-label='Justify text']")).toHaveLength(1);
    expect(document.querySelectorAll("[aria-label='Hyphenate']")).toHaveLength(1);
    expect(document.querySelectorAll("[aria-label='Decrease text size']")).toHaveLength(1);
    expect(document.querySelector("[aria-label='Text size']")).toBeNull();

    const justifySwitch = document.querySelector(
      "[aria-label='Justify text']",
    ) as HTMLButtonElement;
    act(() => {
      justifySwitch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((nextPrefs as ReadingPrefs | null)?.justify).toBe(true);

    const hyphenateSwitch = document.querySelector("[aria-label='Hyphenate']") as HTMLButtonElement;
    act(() => {
      hyphenateSwitch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((nextPrefs as ReadingPrefs | null)?.hyphenate).toBe(true);
  });

  it("groups advanced spacing in a collapsible section with a sticky footer", () => {
    render(
      <AppearancePanel
        open={true}
        prefs={DEFAULT_READING_PREFS}
        onClose={() => {}}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );

    expect(document.querySelector(".folio-theme-grid")).not.toBeNull();
    expect(document.querySelector(".folio-appearance__advanced > summary")?.textContent).toContain(
      "Advanced spacing",
    );
    expect(document.querySelector(".folio-appearance__footer")).not.toBeNull();
    expect(document.body.textContent).toContain("Publisher preserves");
  });

  describe("fixed layout (capabilities.format === 'fixed')", () => {
    const FIXED = {
      format: "fixed",
      typography: false,
      zoom: true,
      flow: true,
      spread: true,
      pageCount: 24,
    } as const;

    it("hides typography controls and shows the zoom stepper", () => {
      const zooms: (1 | -1)[] = [];
      render(
        <AppearancePanel
          open={true}
          prefs={DEFAULT_READING_PREFS}
          onClose={() => {}}
          onChange={() => {}}
          onReset={() => {}}
          capabilities={FIXED}
          zoom={1.25}
          onZoomBy={(d) => {
            zooms.push(d);
          }}
        />,
      );

      // EPUB-only sections are gone
      expect(document.body.textContent).not.toContain("Typeface");
      expect(document.body.textContent).not.toContain("Line spacing");
      expect(document.body.textContent).not.toContain("Margins");
      // zoom stepper shows the absolute zoom and calls back
      const zoomIn = document.querySelector("[aria-label='Zoom in']") as HTMLButtonElement;
      const zoomOut = document.querySelector("[aria-label='Zoom out']") as HTMLButtonElement;
      expect(zoomIn).not.toBeNull();
      expect(zoomOut).not.toBeNull();
      expect(document.body.textContent).toContain("125%");
      act(() => {
        zoomIn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        zoomOut.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(zooms).toEqual([1, -1]);
    });

    it("offers zoom modes through the engine seam, not ReadingPrefs", () => {
      const modes: string[] = [];
      render(
        <AppearancePanel
          open={true}
          prefs={DEFAULT_READING_PREFS}
          onClose={() => {}}
          onChange={() => {}}
          onReset={() => {}}
          capabilities={FIXED}
          zoom="fit-width"
          onZoomMode={(mode) => {
            modes.push(mode);
          }}
        />,
      );
      const radios = Array.from(document.querySelectorAll("[role='radio']")) as HTMLButtonElement[];
      const fitRadio = radios.find((r) => r.textContent?.trim() === "Fit page");
      expect(fitRadio).not.toBeNull();
      act(() => {
        fitRadio!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(modes).toEqual(["fit-page"]);
    });

    it("patches prefs.spread from the page layout radio", () => {
      let nextPrefs: ReadingPrefs | null = null;
      render(
        <AppearancePanel
          open={true}
          prefs={DEFAULT_READING_PREFS}
          onClose={() => {}}
          onChange={(p) => {
            nextPrefs = p;
          }}
          onReset={() => {}}
          capabilities={FIXED}
        />,
      );
      const radios = Array.from(document.querySelectorAll("[role='radio']")) as HTMLButtonElement[];
      const spreadRadio = radios.find((r) => r.textContent?.trim() === "Spreads");
      expect(spreadRadio).not.toBeNull();
      act(() => {
        spreadRadio!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect((nextPrefs as ReadingPrefs | null)?.spread).toBe("both");
    });
  });

  it("repaints the System preview when the OS dark flag changes", () => {
    const system = { ...DEFAULT_READING_PREFS, theme: "system" as const };
    render(
      <AppearancePanel
        open={true}
        prefs={system}
        onClose={() => {}}
        onChange={() => {}}
        onReset={() => {}}
        systemDark={false}
      />,
    );
    const preview = document.querySelector(".folio-typography-preview") as HTMLElement;
    expect(preview.style.backgroundColor).toBe("rgb(250, 250, 247)");

    act(() => {
      root!.render(
        <AppearancePanel
          open={true}
          prefs={system}
          onClose={() => {}}
          onChange={() => {}}
          onReset={() => {}}
          systemDark={true}
        />,
      );
    });
    expect(
      (document.querySelector(".folio-typography-preview") as HTMLElement).style.backgroundColor,
    ).toBe("rgb(18, 18, 20)");
  });

  it("offers a Publisher presentation option without changing the schema-1 theme", () => {
    let publisher: boolean | null = null;
    let changed: ReadingPrefs | null = null;
    render(
      <AppearancePanel
        open={true}
        prefs={DEFAULT_READING_PREFS}
        onClose={() => {}}
        onChange={(p) => (changed = p)}
        onReset={() => {}}
        onPublisherColorsChange={(value) => (publisher = value)}
      />,
    );
    const radios = Array.from(document.querySelectorAll("[role='radio']")) as HTMLButtonElement[];
    const publisherRadio = radios.find((r) => r.textContent?.includes("Publisher"));
    expect(publisherRadio).not.toBeNull();
    act(() => publisherRadio!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(publisher).toBe(true);
    expect(changed).toBeNull(); // no schema-1 field was rewritten

    const darkRadio = radios.find((r) => r.textContent?.includes("Dark"));
    act(() => darkRadio!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(publisher).toBe(false);
    expect((changed as ReadingPrefs | null)?.theme).toBe("dark");
  });
});
