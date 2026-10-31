import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { ReaderContextMenu } from "../src/components/ReaderContextMenu";

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
    document.querySelectorAll(".folio-reader-ctxmenu [role='menuitem']")
  ) as HTMLButtonElement[];
}

function clickItem(label: string) {
  const target = items().find((b) => b.textContent?.includes(label));
  expect(target).toBeDefined();
  act(() => {
    target!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ReaderContextMenu (07 §3 reduced menu)", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders the three reduced actions as a menu", () => {
    render(
      <ReaderContextMenu x={30} y={300} onClose={() => {}} onToggleChrome={() => {}} onToc={() => {}} onBookmark={() => {}} />
    );
    expect(document.querySelector(".folio-reader-ctxmenu[role='menu']")).not.toBeNull();
    const text = items().map((b) => b.textContent);
    expect(text[0]).toContain("Toggle toolbar");
    expect(text[1]).toContain("Table of contents");
    expect(text[2]).toContain("Bookmark position");
  });

  it("dispatches an action and closes", () => {
    const calls: string[] = [];
    render(
      <ReaderContextMenu
        x={30}
        y={300}
        onClose={() => calls.push("closed")}
        onToggleChrome={() => calls.push("chrome")}
        onToc={() => calls.push("toc")}
        onBookmark={() => calls.push("bookmark")}
      />
    );
    clickItem("Bookmark position");
    expect(calls).toEqual(["closed", "bookmark"]);
  });

  it("closes on Escape", () => {
    let closed = false;
    render(
      <ReaderContextMenu x={30} y={300} onClose={() => (closed = true)} onToggleChrome={() => {}} onToc={() => {}} onBookmark={() => {}} />
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(closed).toBe(true);
  });

  it("closes on a mousedown outside the menu", () => {
    let closed = false;
    render(
      <ReaderContextMenu x={30} y={300} onClose={() => (closed = true)} onToggleChrome={() => {}} onToc={() => {}} onBookmark={() => {}} />
    );
    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(closed).toBe(true);
  });
});
