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
    backLabel: "Back to Library",
    title: "Book",
    chapterTitle: "Chapter 1",
    percent: 42,
    timeLeft: null,
    chapterTimeLeft: null,
    chapterMarks: [],
    finished: false,
    scrubValue: null,
    seeking: false,
    bookmarked: false,
    menuOpen: false,
    onMenuChange: () => {},
    onBack: () => {},
    onAppearance: () => {},
    onContents: () => {},
    onSearch: () => {},
    onBookmark: () => {},
    shareEnabled: false,
    onToggleChrome: () => {},
    onHold: () => {},
    onPrevious: () => {},
    onNext: () => {},
    onScrubStart: () => {},
    onScrubChange: () => {},
    onScrubEnd: () => {},
    ...overrides,
  };
}

function byLabel(label: string): HTMLButtonElement {
  const el = document.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`missing control: ${label}`);
  return el as HTMLButtonElement;
}

/** Set a range value the way a browser does (React tracks the old value). */
function setRangeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ReaderChrome top bar", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders the menu popover only when controlled menuOpen is true", () => {
    render(<ReaderChrome {...chromeProps()} />);
    expect(document.querySelector(".folio-reader-menu__popover")).toBeNull();

    act(() => {
      root?.unmount();
    });
    document.body.innerHTML = "";
    render(<ReaderChrome {...chromeProps({ menuOpen: true })} />);
    expect(document.querySelector(".folio-reader-menu__popover")).not.toBeNull();
  });

  it("the More button toggles through onMenuChange", () => {
    let open = false;
    render(
      <ReaderChrome
        {...chromeProps({
          onMenuChange: (next) => {
            open = next;
          },
        })}
      />,
    );
    act(() => {
      byLabel("More").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(open).toBe(true);
  });

  it("exposes Contents, Search, Bookmark and Appearance outside the More menu", () => {
    const hits: string[] = [];
    render(
      <ReaderChrome
        {...chromeProps({
          onContents: () => hits.push("contents"),
          onSearch: () => hits.push("search"),
          onBookmark: () => hits.push("bookmark"),
          onAppearance: () => hits.push("appearance"),
        })}
      />,
    );
    for (const label of ["Contents", "Search in book", "Add bookmark", "Appearance"]) {
      act(() => {
        byLabel(label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(hits).toEqual(["contents", "search", "bookmark", "appearance"]);
  });

  it("uses the caller's context-appropriate back label", () => {
    render(<ReaderChrome {...chromeProps({ backLabel: "Back to Collections" })} />);
    const back = byLabel("Back to Collections");
    expect(back.title).toBe("Back to Collections");
  });

  it("shows and announces the current bookmark state", () => {
    render(<ReaderChrome {...chromeProps({ bookmarked: true })} />);
    const bookmark = byLabel("Remove bookmark");
    expect(bookmark.getAttribute("aria-pressed")).toBe("true");
    expect(bookmark.className).toContain("is-active");
  });

  it("Hide controls closes the menu and toggles the chrome", () => {
    let closed = false;
    let toggled = 0;
    render(
      <ReaderChrome
        {...chromeProps({
          menuOpen: true,
          onMenuChange: (open) => {
            closed = !open;
          },
          onToggleChrome: () => {
            toggled++;
          },
        })}
      />,
    );
    const item = (
      Array.from(document.querySelectorAll("[role='menuitem']")) as HTMLButtonElement[]
    ).find((b) => b.textContent?.includes("Hide controls"))!;
    act(() => {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toggled).toBe(1);
    expect(closed).toBe(true);
  });

  it("hides from assistive tech (and the tab order) when not visible", () => {
    render(<ReaderChrome {...chromeProps({ visible: false })} />);
    const chrome = document.querySelector(".folio-reader-chrome")!;
    expect(chrome.getAttribute("aria-hidden")).toBe("true");
    expect(chrome.hasAttribute("inert")).toBe(true);

    act(() => {
      root?.unmount();
    });
    document.body.innerHTML = "";
    render(<ReaderChrome {...chromeProps()} />);
    const shown = document.querySelector(".folio-reader-chrome")!;
    expect(shown.getAttribute("aria-hidden")).toBe("false");
    expect(shown.hasAttribute("inert")).toBe(false);
  });

  it("keeps a progress hairline at the bottom edge", () => {
    render(<ReaderChrome {...chromeProps({ percent: 37.6 })} />);
    const fill = document.querySelector(".folio-reader-hairline__fill") as HTMLElement;
    expect(fill.style.width).toBe("38%");
  });
});

describe("ReaderDock", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("provides discoverable Previous and Next controls", () => {
    const hits: string[] = [];
    render(
      <ReaderChrome
        {...chromeProps({
          onPrevious: () => hits.push("previous"),
          onNext: () => hits.push("next"),
        })}
      />,
    );
    act(() => {
      byLabel("Previous page").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      byLabel("Next page").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(hits).toEqual(["previous", "next"]);
  });

  it("previews while dragging and commits exactly once on release", () => {
    const calls: string[] = [];
    render(
      <ReaderChrome
        {...chromeProps({
          onScrubStart: () => calls.push("start"),
          onScrubChange: (p) => calls.push(`change:${p}`),
          onScrubEnd: (p) => calls.push(`end:${p}`),
        })}
      />,
    );
    const slider = document.querySelector(".folio-reader-dock__slider") as HTMLInputElement;

    act(() => {
      slider.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    act(() => setRangeValue(slider, "60"));
    act(() => {
      slider.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    // A stray blur after the pointer release must not jump a second time.
    act(() => {
      slider.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(calls).toEqual(["start", "change:60", "end:60"]);
  });

  it("supports keyboard scrubbing with one commit on key release", () => {
    // R11: arrow nudges fire the change immediately on keydown (whole-point
    // steps over the 0.1% slider), keyup commits exactly once.
    const calls: string[] = [];
    render(
      <ReaderChrome
        {...chromeProps({
          percent: 42,
          onScrubStart: () => calls.push("start"),
          onScrubChange: (p) => calls.push(`change:${p}`),
          onScrubEnd: (p) => calls.push(`end:${p}`),
        })}
      />,
    );
    const slider = document.querySelector(".folio-reader-dock__slider") as HTMLInputElement;

    act(() => {
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    act(() => {
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    act(() => {
      slider.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }));
    });
    // A stray blur after the key release must not commit a second time.
    act(() => {
      slider.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(calls).toEqual(["start", "change:43", "change:42", "end:42"]);
  });

  it("shows seeking feedback while a jump resolves", () => {
    render(<ReaderChrome {...chromeProps({ seeking: true })} />);
    expect(document.querySelector(".folio-reader-dock__seeking")?.textContent).toContain("Jumping");
    expect(document.querySelector(".folio-reader-dock__slider")?.getAttribute("aria-busy")).toBe(
      "true",
    );
  });

  it("draws a tick per chapter mark and shows the scrub tooltip (R11)", () => {
    const marks = [
      { percent: 0, title: "Chapter 1" },
      { percent: 40, title: "Chapter 2" },
      { percent: 75, title: "Chapter 3" },
    ];
    render(
      <ReaderChrome
        {...chromeProps({
          percent: 10,
          chapterMarks: marks,
          scrubValue: 55,
        })}
      />,
    );
    const ticks = document.querySelectorAll(".folio-reader-dock__tick");
    expect(ticks.length).toBe(3);

    const tooltip = document.querySelector(".folio-reader-dock__tooltip");
    expect(tooltip?.textContent).toContain("55%");
    expect(tooltip?.textContent).toContain("Chapter 2"); // last mark ≤ 55
    expect(
      document.querySelector(".folio-reader-dock__slider")?.getAttribute("aria-valuetext"),
    ).toBe("55 percent, Chapter 2");
  });

  it("hides the tooltip when not scrubbing and floors the percent label (R11)", () => {
    render(
      <ReaderChrome
        {...chromeProps({ percent: 37.6, chapterMarks: [{ percent: 0, title: "Chapter 1" }] })}
      />,
    );
    expect(document.querySelector(".folio-reader-dock__tooltip")).toBeNull();
    expect(document.querySelector(".folio-reader-dock__percent")?.textContent).toBe("37%");
  });

  it("replaces the percent label with Finished at the end of the book (R11)", () => {
    render(
      <ReaderChrome {...chromeProps({ percent: 100, finished: true, timeLeft: "≈ 2 h left" })} />,
    );
    const percent = document.querySelector(".folio-reader-dock__percent");
    expect(percent?.textContent).toBe("Finished");
    expect(percent?.className).toContain("folio-reader-dock__percent--finished");
    // No time estimates once the book is finished.
    expect(document.querySelector(".folio-reader-dock__time")).toBeNull();
    expect(document.querySelector(".folio-reader-dock__chaptertime")).toBeNull();
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
