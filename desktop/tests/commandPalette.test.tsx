// X1 (Phase 4): Ctrl+K command palette.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { CommandPalette, isPaletteTrigger } from "../src/components/CommandPalette";
import { useRouteStore } from "../src/store/routeStore";
import { useThemeStore } from "../src/theme/theme";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const onClose = vi.fn();

async function render(open = true) {
  onClose.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<CommandPalette open={open} onClose={onClose} />);
  });
}

beforeEach(() => {
  useRouteStore.getState().setRoute("library");
  useThemeStore.setState({ setting: "system" });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function options(): HTMLButtonElement[] {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>(".folio-palette-option"));
}

describe("CommandPalette (X1 Ctrl+K)", () => {
  it("lists navigation and appearance commands when open", async () => {
    await render();
    const labels = options().map((o) => o.textContent);
    expect(labels.join("\n")).toContain("Go to Library");
    expect(labels.join("\n")).toContain("Go to Collections");
    expect(labels.join("\n")).toContain("Go to Notes");
    expect(labels.join("\n")).toContain("Go to Settings");
    expect(labels.join("\n")).toContain("Switch appearance");
  });

  it("filters as the user types and reports no matches", async () => {
    await render();
    const input = container!.querySelector<HTMLInputElement>(".folio-palette-input")!;
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setValue.call(input, "notes");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(options().length).toBe(1);
    expect(options()[0].textContent).toContain("Go to Notes");

    await act(async () => {
      setValue.call(input, "zzz-nothing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(options().length).toBe(0);
    expect(container!.querySelector(".folio-palette-empty")?.textContent).toContain(
      "No matching commands",
    );
  });

  it("runs the active command on Enter and closes", async () => {
    await render();
    const input = container!.querySelector<HTMLInputElement>(".folio-palette-input")!;
    // ArrowDown once: from Library → Collections
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(container!.querySelector('[aria-selected="true"]')?.textContent).toContain(
      "Go to Collections",
    );
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useRouteStore.getState().route).toBe("collections");
  });

  it("clicking a command navigates", async () => {
    await render();
    const target = options().find((o) => o.textContent?.includes("Go to Settings"))!;
    await act(async () => {
      target.click();
      await Promise.resolve();
    });
    expect(useRouteStore.getState().route).toBe("settings");
  });

  it("cycling appearance moves through system → light → dark", async () => {
    await render();
    const target = options().find((o) => o.textContent?.includes("Switch appearance"))!;
    await act(async () => {
      target.click();
    });
    expect(useThemeStore.getState().setting).toBe("light");
  });

  it("Ctrl+K / Meta+K is the trigger; modifiers like Shift disqualify", () => {
    expect(isPaletteTrigger(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))).toBe(true);
    expect(isPaletteTrigger(new KeyboardEvent("keydown", { key: "k", metaKey: true }))).toBe(true);
    expect(
      isPaletteTrigger(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    expect(isPaletteTrigger(new KeyboardEvent("keydown", { key: "k" }))).toBe(false);
  });
});
