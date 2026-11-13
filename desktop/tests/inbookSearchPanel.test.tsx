import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { InBookSearchPanel } from "../src/components/InBookSearchPanel";

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

describe("InBookSearchPanel", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders search input with clear button and status", () => {
    let queryVal = "mystery";
    render(
      <InBookSearchPanel
        open={true}
        query={queryVal}
        results={[]}
        isSearching={false}
        onQueryChange={() => {}}
        onClear={() => {
          queryVal = "";
        }}
        onClose={() => {}}
        onSelectResult={() => {}}
      />,
    );

    const input = document.querySelector(".folio-inbook-search-panel__input") as HTMLInputElement;
    expect(input.value).toBe("mystery");

    const clearBtn = document.querySelector(
      ".folio-inbook-search-panel__clear",
    ) as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    act(() => {
      clearBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(queryVal).toBe("");
  });

  it("shows searching indicator while active", () => {
    render(
      <InBookSearchPanel
        open={true}
        query="detective"
        results={[]}
        isSearching={true}
        onQueryChange={() => {}}
        onClear={() => {}}
        onClose={() => {}}
        onSelectResult={() => {}}
      />,
    );

    expect(document.querySelector(".folio-inbook-search-panel__loading")?.textContent).toContain(
      "Searching in book…",
    );
  });

  it("displays matches and navigates on result click", async () => {
    let selectedLocator = "";
    let closed = false;

    const onSelect = vi.fn().mockImplementation(async (loc: string) => {
      selectedLocator = loc;
      return { ok: true, superseded: false };
    });

    render(
      <InBookSearchPanel
        open={true}
        query="sherlock"
        results={[
          {
            chapterTitle: "Chapter 1",
            snippetHtml: "It was <mark>Sherlock</mark> Holmes who spoke.",
            locator: "text/ch1.xhtml#p4",
          },
        ]}
        isSearching={false}
        onQueryChange={() => {}}
        onClear={() => {}}
        onClose={() => {
          closed = true;
        }}
        onSelectResult={onSelect}
      />,
    );

    expect(document.querySelector(".folio-inbook-search-panel__count")?.textContent).toContain(
      "1 match found",
    );

    const resultCard = document.querySelector(
      ".folio-inbook-search-panel__card",
    ) as HTMLButtonElement;
    expect(resultCard.textContent).toContain("Chapter 1");
    expect(resultCard.innerHTML).toContain("<mark>Sherlock</mark>");

    await act(async () => {
      resultCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(selectedLocator).toBe("text/ch1.xhtml#p4");
    expect(closed).toBe(true);
  });

  it("displays no-matches empty state when query returns 0 hits", () => {
    render(
      <InBookSearchPanel
        open={true}
        query="xyznotfound"
        results={[]}
        isSearching={false}
        onQueryChange={() => {}}
        onClear={() => {}}
        onClose={() => {}}
        onSelectResult={() => {}}
      />,
    );

    expect(document.querySelector(".folio-workspace__empty-title")?.textContent).toBe(
      "No matches found",
    );
  });
});
