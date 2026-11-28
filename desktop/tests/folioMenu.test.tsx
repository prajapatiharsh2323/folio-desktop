// UI-003: anchored menus with role="menu" must support arrow/Home/End
// navigation between enabled items.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { FolioMenu, type FolioMenuItem } from "../src/components/FolioMenu";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const ITEMS: FolioMenuItem[] = [
  { key: "a", label: "Alpha", onSelect: () => {} },
  { key: "b", label: "Beta", onSelect: () => {}, disabled: true },
  { key: "c", label: "Gamma", onSelect: () => {} },
];

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function render(items: FolioMenuItem[] = ITEMS) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <FolioMenu
        anchorRect={{ top: 10, left: 10, right: 60, bottom: 40 }}
        items={items}
        label="Actions"
        onClose={vi.fn()}
      />,
    );
  });
}

function items(): HTMLButtonElement[] {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>("button[role='menuitem']"));
}

function press(key: string) {
  act(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("FolioMenu keyboard semantics (UI-003)", () => {
  it("focuses the first enabled item and skips disabled ones with arrows", async () => {
    await render();
    expect(document.activeElement).toBe(items()[0]);
    press("ArrowDown");
    expect(document.activeElement).toBe(items()[2]);
    press("ArrowDown");
    expect(document.activeElement).toBe(items()[0]); // wraps
    press("ArrowUp");
    expect(document.activeElement).toBe(items()[2]);
  });

  it("supports Home and End", async () => {
    await render();
    press("End");
    expect(document.activeElement).toBe(items()[2]);
    press("Home");
    expect(document.activeElement).toBe(items()[0]);
  });

  it("uses a roving tab stop", async () => {
    await render();
    expect(items().map((i) => i.tabIndex)).toEqual([0, -1, -1]);
    press("ArrowDown");
    expect(items().map((i) => i.tabIndex)).toEqual([-1, -1, 0]);
  });
});
