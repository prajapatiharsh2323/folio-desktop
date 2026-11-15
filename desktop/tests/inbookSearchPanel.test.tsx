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

  it("renders search input with clear button", () => {
    let queryVal = "mystery";
    render(
      <InBookSearchPanel
        open={true}
        query={queryVal}
        results={[]}
        activeIndex={-1}
        isSearching={false}
        onQueryChange={() => {}}
        onClear={() => {
          queryVal = "";
        }}
        onClose={() => {}}
        onSelectResult={() => {}}
        onNext={() => {}}
        onPrev={() => {}}
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
        activeIndex={-1}
        isSearching={true}
        onQueryChange={() => {}}
        onClear={() => {}}
        onClose={() => {}}
        onSelectResult={() => {}}
        onNext={() => {}}
        onPrev={() => {}}
      />,
    );

    expect(document.querySelector(".folio-inbook-search-panel__loading")?.textContent).toContain(
      "Searching in book…",
    );
  });

  it("groups matches by chapter, counts, and steps next/prev", () => {
    let moved = 0;
    render(
      <InBookSearchPanel
        open={true}
        query="sherlock"
        results={[
          {
            chapterTitle: "Chapter 1",
            snippet: {
            head: false,
            tail: false,
            parts: [
              { text: "It was ", mark: false },
              { text: "Sherlock", mark: true },
              { text: " Holmes who spoke.", mark: false },
            ],
          },
            locator: "text/ch1.xhtml#p4",
          },
          {
            chapterTitle: "Chapter 1",
            snippet: {
            head: false,
            tail: false,
            parts: [
              { text: "Sherlock", mark: true },
              { text: " closed the door.", mark: false },
            ],
          },
            locator: "text/ch1.xhtml#p7",
          },
          {
            chapterTitle: "Chapter 2",
            snippet: {
            head: false,
            tail: false,
            parts: [
              { text: "Sherlock", mark: true },
              { text: " smiled.", mark: false },
            ],
          },
            locator: "text/ch2.xhtml#p1",
          },
        ]}
        activeIndex={1}
        isSearching={false}
        onQueryChange={() => {}}
        onClear={() => {}}
        onClose={() => {}}
        onSelectResult={() => {}}
        onNext={() => {
          moved += 1;
        }}
        onPrev={() => {
          moved -= 1;
        }}
      />,
    );

    // Counter reflects the active match.
    expect(document.querySelector(".folio-inbook-search-panel__count")?.textContent).toContain(
      "2 of 3 matches",
    );

    // Chapter groups with per-chapter counts.
    const chapters = document.querySelectorAll(".folio-inbook-search-panel__chapter");
    expect(chapters).toHaveLength(2);
    expect(chapters[0].textContent).toContain("Chapter 1");
    expect(
      chapters[0].querySelector(".folio-inbook-search-panel__chapter-count")?.textContent,
    ).toBe("2");

    // Active card is highlighted.
    const cards = document.querySelectorAll(".folio-inbook-search-panel__card");
    expect(cards).toHaveLength(3);
    expect(cards[1].classList.contains("is-active")).toBe(true);

    // Step buttons move through matches.
    act(() => {
      (
        document.querySelector(
          '.folio-inbook-search-panel__step[aria-label^="Next"]',
        ) as HTMLElement
      )
        .closest("button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(moved).toBe(1);
  });

  it("selects a result and keeps the panel open", async () => {
    const selected: Array<{ index: number; locator: string }> = [];
    let closed = false;

    const onSelect = vi.fn().mockImplementation(async (_hit, index: number) => {
      selected.push({ index, locator: hitAt(index) });
      return { ok: true, superseded: false };
    });
    function hitAt(index: number) {
      return index === 0 ? "text/ch1.xhtml#p4" : "text/ch1.xhtml#p7";
    }

    render(
      <InBookSearchPanel
        open={true}
        query="sherlock"
        results={[
          {
            chapterTitle: "Chapter 1",
            snippet: {
            head: false,
            tail: false,
            parts: [
              { text: "It was ", mark: false },
              { text: "Sherlock", mark: true },
              { text: " Holmes who spoke.", mark: false },
            ],
          },
            locator: "text/ch1.xhtml#p4",
          },
          {
            chapterTitle: "Chapter 1",
            snippet: {
            head: false,
            tail: false,
            parts: [
              { text: "Sherlock", mark: true },
              { text: " closed the door.", mark: false },
            ],
          },
            locator: "text/ch1.xhtml#p7",
          },
        ]}
        activeIndex={-1}
        isSearching={false}
        onQueryChange={() => {}}
        onClear={() => {}}
        onClose={() => {
          closed = true;
        }}
        onSelectResult={onSelect}
        onNext={() => {}}
        onPrev={() => {}}
      />,
    );

    expect(document.querySelector(".folio-inbook-search-panel__count")?.textContent).toContain(
      "2 matches found",
    );

    const resultCard = document.querySelector(
      ".folio-inbook-search-panel__card",
    ) as HTMLButtonElement;
    expect(resultCard.textContent).toContain("Sherlock");
    expect(resultCard.innerHTML).toContain("<mark>Sherlock</mark>");

    await act(async () => {
      resultCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(selected).toEqual([{ index: 0, locator: "text/ch1.xhtml#p4" }]);
    // The panel stays open so the user can step through matches.
    expect(closed).toBe(false);
  });

  it("shows a failure notice when a result cannot be reached", async () => {
    const onSelect = vi.fn().mockResolvedValue({ ok: false, superseded: false });

    render(
      <InBookSearchPanel
        open={true}
        query="sherlock"
        results={[
          {
            chapterTitle: "Chapter 1",
            snippet: {
            head: false,
            tail: false,
            parts: [
              { text: "It was ", mark: false },
              { text: "Sherlock", mark: true },
              { text: " Holmes who spoke.", mark: false },
            ],
          },
            locator: "text/ch1.xhtml#p4",
          },
        ]}
        activeIndex={-1}
        isSearching={false}
        onQueryChange={() => {}}
        onClear={() => {}}
        onClose={() => {}}
        onSelectResult={onSelect}
        onNext={() => {}}
        onPrev={() => {}}
      />,
    );

    const resultCard = document.querySelector(
      ".folio-inbook-search-panel__card",
    ) as HTMLButtonElement;
    await act(async () => {
      resultCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't reach that search location.",
    );
  });

  it("displays no-matches empty state when query returns 0 hits", () => {
    render(
      <InBookSearchPanel
        open={true}
        query="xyznotfound"
        results={[]}
        activeIndex={-1}
        isSearching={false}
        onQueryChange={() => {}}
        onClear={() => {}}
        onClose={() => {}}
        onSelectResult={() => {}}
        onNext={() => {}}
        onPrev={() => {}}
      />,
    );

    expect(document.querySelector(".folio-workspace__empty-title")?.textContent).toBe(
      "No matches found",
    );
  });
});
