// PDF thumbnail strip renders a bounded window around the reading page and
// navigates to the clicked page.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { PdfThumbnailStrip } from "../src/components/PdfThumbnailStrip";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

describe("PdfThumbnailStrip", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders the cover and a window around the current page", async () => {
    const render = vi.fn(async (page: number) => `data:image/jpeg;base64,${page}`);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <PdfThumbnailStrip
          open={true}
          page={20}
          pageCount={200}
          onSelect={() => {}}
          renderThumbnail={render}
        />,
      );
    });
    const buttons = Array.from(
      document.querySelectorAll(".folio-pdf-thumbnail"),
    ) as HTMLButtonElement[];
    const pages = buttons.map((b) => Number(b.getAttribute("aria-label")!.replace(/\D/g, "")));
    expect(pages).toContain(1);
    expect(pages).toContain(20);
    expect(pages.length).toBeLessThanOrEqual(19); // cover + ±8 window
    expect(buttons.find((b) => b.getAttribute("aria-current") === "page")).not.toBeNull();
  });

  it("navigates on click and renders nothing when closed", async () => {
    const onSelect = vi.fn();
    const render = vi.fn(async () => "data:image/jpeg;base64,x");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <PdfThumbnailStrip
          open={true}
          page={2}
          pageCount={5}
          onSelect={onSelect}
          renderThumbnail={render}
        />,
      );
    });
    const button = document.querySelector(".folio-pdf-thumbnail") as HTMLButtonElement;
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelect).toHaveBeenCalled();

    await act(async () => {
      root!.render(
        <PdfThumbnailStrip
          open={false}
          page={2}
          pageCount={5}
          onSelect={onSelect}
          renderThumbnail={render}
        />,
      );
    });
    expect(document.querySelector(".folio-pdf-thumbnails")).toBeNull();
  });
});
