import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { ReaderChrome } from "../src/components/ReaderChrome";
import { tocHrefMatches } from "../src/components/TocPanel";

// React 18 act() environment flag (silences testing-env warning)
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

function chromeProps(overrides: Partial<React.ComponentProps<typeof ReaderChrome>> = {}) {
  return {
    visible: true,
    title: "Book",
    chapterTitle: "Chapter 1",
    percent: 42,
    timeLeft: null,
    scrubValue: null,
    menuOpen: false,
    onMenuChange: () => {},
    onBack: () => {},
    onAppearance: () => {},
    onToc: () => {},
    onSearch: () => {},
    onBookmark: () => {},
    onScrubStart: () => {},
    onScrubChange: () => {},
    onScrubEnd: () => {},
    ...overrides,
  };
}

describe("ReaderChrome menu (controlled, 04 §5)", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders the menu popover only when controlled menuOpen is true", () => {
    render(<ReaderChrome {...chromeProps()} />);
    expect(document.querySelector(".folio-reader-menu__popover")).toBeNull();

    document.body.innerHTML = "";
    act(() => {
      root?.unmount();
    });
    render(<ReaderChrome {...chromeProps({ menuOpen: true })} />);
    expect(document.querySelector(".folio-reader-menu__popover")).not.toBeNull();
  });

  it("the More button toggles through onMenuChange", () => {
    let open = false;
    const spy = (next: boolean) => {
      open = next;
    };
    render(<ReaderChrome {...chromeProps({ menuOpen: open, onMenuChange: spy })} />);
    const more = document.getElementById("folio-reader-more")!;
    act(() => {
      more.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(open).toBe(true);
  });

  it("has no disabled No-op menu items: bookmark is a live action", () => {
    render(<ReaderChrome {...chromeProps({ menuOpen: true })} />);
    const items = Array.from(document.querySelectorAll("[role='menuitem']")) as HTMLButtonElement[];
    const bookmark = items.find((b) => b.textContent?.includes("bookmark"));
    expect(bookmark).toBeDefined();
    expect(bookmark!.disabled).toBe(false);
  });

  it("clicking the bookmark item fires onBookmark and closes the menu", () => {
    let bookmarked = 0;
    let closed = false;
    render(
      <ReaderChrome
        {...chromeProps({
          menuOpen: true,
          onMenuChange: (open) => {
            closed = !open;
          },
          onBookmark: () => {
            bookmarked++;
          },
        })}
      />
    );
    const item = (Array.from(document.querySelectorAll("[role='menuitem']")) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes("bookmark")
    )!;
    act(() => {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(bookmarked).toBe(1);
    expect(closed).toBe(true);
  });
});

describe("tocHrefMatches (TOC active-chapter reliability)", () => {
  it("matches identical hrefs", () => {
    expect(tocHrefMatches("text/chap1.xhtml", "text/chap1.xhtml")).toBe(true);
  });

  it("ignores fragments", () => {
    expect(tocHrefMatches("text/chap1.xhtml", "text/chap1.xhtml#para-3")).toBe(true);
    expect(tocHrefMatches("text/chap1.xhtml#intro", "text/chap1.xhtml")).toBe(true);
  });

  it("tolerates percent-encoding differences", () => {
    expect(tocHrefMatches("text/na%C3%AFve.xhtml", "text/naïve.xhtml")).toBe(true);
  });

  it("does not confuse different chapters", () => {
    expect(tocHrefMatches("text/chap1.xhtml", "text/chap2.xhtml")).toBe(false);
    expect(tocHrefMatches(null, "text/chap1.xhtml")).toBe(false);
  });
});
