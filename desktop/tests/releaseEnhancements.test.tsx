import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { FolioButton } from "../src/components/FolioButton";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

describe("FolioButton (size variants & accessibility)", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders default button with folio-btn and primary variant by default", () => {
    render(<FolioButton>Click me</FolioButton>);
    const btn = document.querySelector("button") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.className).toContain("folio-btn");
    expect(btn.className).toContain("folio-btn--primary");
    expect(btn.className).not.toContain("folio-btn--sm");
  });

  it("renders compact size='sm' button with folio-btn--sm", () => {
    render(<FolioButton size="sm" variant="secondary">Compact Action</FolioButton>);
    const btn = document.querySelector("button") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.className).toContain("folio-btn");
    expect(btn.className).toContain("folio-btn--secondary");
    expect(btn.className).toContain("folio-btn--sm");
  });

  it("respects disabled state and type='button' attribute", () => {
    render(<FolioButton disabled>Disabled Action</FolioButton>);
    const btn = document.querySelector("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("type")).toBe("button");
  });
});

describe("Custom scrollbar styles", () => {
  it("base.css declares custom scrollbar rules for thin width and transparent track", () => {
    const baseCss = readFileSync(resolve(process.cwd(), "src/styles/base.css"), "utf8");
    expect(baseCss).toContain("scrollbar-width: thin;");
    expect(baseCss).toContain("scrollbar-color: var(--folio-border) transparent;");
    expect(baseCss).toContain("::-webkit-scrollbar");
    expect(baseCss).toContain("::-webkit-scrollbar-thumb");
  });
});

