import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { ReadingSessionDialog } from "../src/components/ReadingSessionDialog";
import { KeyboardShortcutsDialog } from "../src/components/KeyboardShortcutsDialog";
import { ReaderChrome } from "../src/components/ReaderChrome";

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

describe("ReadingSessionDialog", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("displays session duration, book progress %, and estimated remaining time", () => {
    let closed = false;
    render(
      <ReadingSessionDialog
        open={true}
        onClose={() => {
          closed = true;
        }}
        title="Moby Dick"
        chapterTitle="Chapter 1: Loomings"
        percent={35.4}
        timeLeft="≈ 42 min left"
        sessionDurationMs={15 * 60 * 1000} // 15 min
        totalReadingTimeMs={60 * 60 * 1000} // 1 hr
        totalChapters={84}
      />,
    );

    expect(document.body.textContent).toContain("Moby Dick");
    expect(document.body.textContent).toContain("Chapter 1: Loomings");
    expect(document.body.textContent).toContain("35%");
    expect(document.body.textContent).toContain("15 min");
    expect(document.body.textContent).toContain("≈ 42 min left");
    expect(document.body.textContent).toContain("84 chapters");

    const doneBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Done"),
    ) as HTMLButtonElement;
    act(() => {
      doneBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(closed).toBe(true);
  });
});

describe("KeyboardShortcutsDialog", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("lists all key combinations including page navigation, tools, and escape", () => {
    render(<KeyboardShortcutsDialog open={true} onClose={() => {}} />);

    expect(document.body.textContent).toContain("Keyboard Shortcuts");
    expect(document.body.textContent).toContain("Page Navigation");
    expect(document.body.textContent).toContain("Reading Tools");
    expect(document.body.textContent).toContain("View & Controls");
    expect(document.body.textContent).toContain("PageDown");
    expect(document.body.textContent).toContain("PageUp");
    expect(document.body.textContent).toContain("Ctrl");
    expect(document.body.textContent).toContain("Escape");
  });
});

describe("ReaderChrome Focus Mode & Menu Items", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders Focus Mode exit button when isFocusMode is true", () => {
    let exited = false;
    render(
      <ReaderChrome
        visible={true}
        backLabel="Back"
        title="Title"
        chapterTitle="Chapter"
        percent={50}
        timeLeft={null}
        scrubValue={null}
        seeking={false}
        bookmarked={false}
        menuOpen={false}
        isFocusMode={true}
        onFocusMode={() => {
          exited = true;
        }}
        onMenuChange={() => {}}
        onBack={() => {}}
        onAppearance={() => {}}
        onContents={() => {}}
        onBookmark={() => {}}
        onToggleChrome={() => {}}
        onHold={() => {}}
        onPrevious={() => {}}
        onNext={() => {}}
        onScrubStart={() => {}}
        onScrubChange={() => {}}
        onScrubEnd={() => {}}
      />,
    );

    const exitBtn = document.querySelector(".folio-reader-focus-exit__btn") as HTMLButtonElement;
    expect(exitBtn).not.toBeNull();
    expect(exitBtn.textContent).toContain("Exit Focus Mode");

    act(() => {
      exitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(exited).toBe(true);
  });

  it("exposes Focus Mode, Reading Session, and Shortcuts in More menu", () => {
    let focusClicked = false;
    let sessionClicked = false;
    let shortcutsClicked = false;

    render(
      <ReaderChrome
        visible={true}
        backLabel="Back"
        title="Title"
        chapterTitle="Chapter"
        percent={50}
        timeLeft={null}
        scrubValue={null}
        seeking={false}
        bookmarked={false}
        menuOpen={true}
        onFocusMode={() => {
          focusClicked = true;
        }}
        onSessionInfo={() => {
          sessionClicked = true;
        }}
        onShortcutsGuide={() => {
          shortcutsClicked = true;
        }}
        onMenuChange={() => {}}
        onBack={() => {}}
        onAppearance={() => {}}
        onContents={() => {}}
        onBookmark={() => {}}
        onToggleChrome={() => {}}
        onHold={() => {}}
        onPrevious={() => {}}
        onNext={() => {}}
        onScrubStart={() => {}}
        onScrubChange={() => {}}
        onScrubEnd={() => {}}
      />,
    );

    const menuItems = Array.from(
      document.querySelectorAll("[role='menuitem']"),
    ) as HTMLButtonElement[];
    const focusItem = menuItems.find((b) => b.textContent?.includes("Focus mode"));
    const sessionItem = menuItems.find((b) => b.textContent?.includes("Reading session"));
    const shortcutsItem = menuItems.find((b) => b.textContent?.includes("Keyboard shortcuts"));

    expect(focusItem).toBeDefined();
    expect(sessionItem).toBeDefined();
    expect(shortcutsItem).toBeDefined();

    act(() => {
      focusItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(focusClicked).toBe(true);

    act(() => {
      sessionItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(sessionClicked).toBe(true);

    act(() => {
      shortcutsItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(shortcutsClicked).toBe(true);
  });
});
