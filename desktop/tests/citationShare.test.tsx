// R6: the selection toolbar acts on the live selection — Copy with citation
// and Share buttons exist and fire; the citation line quotes the selection
// and names the book (author optional).
import { describe, it, expect, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { SelectionToolbar } from "../src/components/SelectionToolbar";
import { citationFor } from "../src/screens/reader/citation";

describe("citationFor (R6)", () => {
  it("quotes the selection and names title and author", () => {
    expect(citationFor("  A fine line ", "Waves", "R. M.").trim()).toBe(
      "\u201CA fine line\u201D — Waves, R. M.",
    );
  });

  it("omits the author when the book has none", () => {
    expect(citationFor("A fine line", "Waves", null)).toBe("\u201CA fine line\u201D — Waves");
  });
});

describe("SelectionToolbar share + citation (R6)", () => {
  it("has Copy-with-citation and Share buttons wired to the live selection", () => {
    const onCopyCitation = vi.fn();
    const onShare = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => {
      root.render(
        <SelectionToolbar
          rect={{ top: 10, left: 10, bottom: 12, right: 100 }}
          onHighlight={() => {}}
          onNote={() => {}}
          onCopy={() => {}}
          onCopyCitation={onCopyCitation}
          onShare={onShare}
        />,
      );
    });

    const byLabel = (label: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.getAttribute("aria-label") === label,
      );

    expect(byLabel("Copy with citation")).toBeDefined();
    expect(byLabel("Share as image")).toBeDefined();

    act(() => {
      byLabel("Copy with citation")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      byLabel("Share as image")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCopyCitation).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });
});
