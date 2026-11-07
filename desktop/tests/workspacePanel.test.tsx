import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { TocPanel } from "../src/components/TocPanel";
import type { TocEntry } from "../src/reader/ReaderEngine";
import type { Annotation, Chapter } from "../src/model/types";

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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const SAMPLE_ENTRIES: TocEntry[] = [
  { title: "Prologue", href: "text/prologue.xhtml", depth: 0 },
  { title: "Part One", href: "text/part1.xhtml", depth: 0 },
  { title: "Chapter 1", href: "text/part1.xhtml#ch1", depth: 1 },
  { title: "Chapter 2", href: "text/part1.xhtml#ch2", depth: 1 },
  { title: "Part Two", href: "text/part2.xhtml", depth: 0 },
];

const SAMPLE_CHAPTERS: Chapter[] = [
  { id: "prologue", href: "text/prologue.xhtml", title: "Prologue", order: 0 },
  { id: "part1", href: "text/part1.xhtml", title: "Part One", order: 1 },
  { id: "part2", href: "text/part2.xhtml", title: "Part Two", order: 2 },
];

const SAMPLE_ANNOTATIONS: Annotation[] = [
  {
    id: "bm-1",
    docId: "doc-1",
    chapterId: "part1",
    quote: "",
    prefix: "",
    suffix: "",
    location: "text/part1.xhtml#ch1",
    kind: "bookmark",
    color: null,
    note: null,
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
  },
  {
    id: "hl-1",
    docId: "doc-1",
    chapterId: "part1",
    quote: "A memorable sentence.",
    prefix: "Before ",
    suffix: " after",
    location: "text/part1.xhtml#ch1",
    kind: "highlight",
    color: "yellow",
    note: null,
    createdAt: "2026-11-01T11:00:00Z",
    updatedAt: "2026-11-01T11:00:00Z",
  },
  {
    id: "note-1",
    docId: "doc-1",
    chapterId: "part2",
    quote: "Important plot point.",
    prefix: "",
    suffix: "",
    location: "text/part2.xhtml",
    kind: "note",
    color: "green",
    note: "Must remember this twist!",
    createdAt: "2026-11-01T12:00:00Z",
    updatedAt: "2026-11-01T12:00:00Z",
  },
];

describe("TocPanel / Reading Workspace", () => {
  beforeEach(() => {
    root = null;
    document.body.innerHTML = "";
  });

  it("renders the 3 workspace tabs: Contents, Bookmarks, and Notes", () => {
    render(
      <TocPanel
        open={true}
        entries={SAMPLE_ENTRIES}
        annotations={SAMPLE_ANNOTATIONS}
        chapters={SAMPLE_CHAPTERS}
        onClose={() => {}}
        onSelect={() => {}}
      />,
    );

    const tabs = Array.from(document.querySelectorAll("[role='tab']"));
    expect(tabs.length).toBe(3);
    expect(tabs[0].textContent).toContain("Contents");
    expect(tabs[1].textContent).toContain("Bookmarks");
    expect(tabs[1].textContent).toContain("1");
    expect(tabs[2].textContent).toContain("Notes");
    expect(tabs[2].textContent).toContain("2");
  });

  it("filters chapters in real time when searching", () => {
    render(
      <TocPanel
        open={true}
        entries={SAMPLE_ENTRIES}
        onClose={() => {}}
        onSelect={() => {}}
      />,
    );

    const searchInput = document.querySelector(
      ".folio-workspace__search-input",
    ) as HTMLInputElement;
    expect(searchInput).not.toBeNull();
    expect(document.querySelectorAll(".folio-toc__item").length).toBe(5);

    act(() => {
      setInputValue(searchInput, "Chapter");
    });

    const items = Array.from(document.querySelectorAll(".folio-toc__item"));
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("Chapter 1");
    expect(items[1].textContent).toContain("Chapter 2");
  });

  it("marks active chapter with is-current and aria-current='location'", () => {
    render(
      <TocPanel
        open={true}
        entries={SAMPLE_ENTRIES}
        currentHref="text/part1.xhtml#ch1"
        onClose={() => {}}
        onSelect={() => {}}
      />,
    );

    const currentItem = document.querySelector(".folio-toc__item.is-current");
    expect(currentItem).not.toBeNull();
    expect(currentItem?.textContent).toContain("Chapter 1");
    expect(currentItem?.getAttribute("aria-current")).toBe("location");
  });

  it("defers closing until navigation succeeds, and closes on success", async () => {
    let closed = false;
    let selectedHref = "";

    const onSelect = vi.fn().mockImplementation(async (href: string) => {
      selectedHref = href;
      return { ok: true, superseded: false };
    });

    render(
      <TocPanel
        open={true}
        entries={SAMPLE_ENTRIES}
        onClose={() => {
          closed = true;
        }}
        onSelect={onSelect}
      />,
    );

    const prologueBtn = Array.from(
      document.querySelectorAll(".folio-toc__item"),
    ).find((b) => b.textContent?.includes("Prologue")) as HTMLButtonElement;

    await act(async () => {
      prologueBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith("text/prologue.xhtml");
    expect(selectedHref).toBe("text/prologue.xhtml");
    expect(closed).toBe(true);
  });

  it("keeps panel open and displays understandable error banner on navigation failure", async () => {
    let closed = false;

    const onSelect = vi.fn().mockImplementation(async () => {
      return { ok: false, superseded: false, reason: "Error" };
    });

    render(
      <TocPanel
        open={true}
        entries={SAMPLE_ENTRIES}
        onClose={() => {
          closed = true;
        }}
        onSelect={onSelect}
      />,
    );

    const prologueBtn = Array.from(
      document.querySelectorAll(".folio-toc__item"),
    ).find((b) => b.textContent?.includes("Prologue")) as HTMLButtonElement;

    await act(async () => {
      prologueBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(closed).toBe(false);
    const notice = document.querySelector(".folio-workspace__notice--error");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Couldn't reach that section.");
  });

  it("navigates to saved bookmarks from Bookmarks tab and supports removal", async () => {
    let jumpedLocation = "";
    let removedId = "";

    render(
      <TocPanel
        open={true}
        initialTab="bookmarks"
        entries={SAMPLE_ENTRIES}
        annotations={SAMPLE_ANNOTATIONS}
        chapters={SAMPLE_CHAPTERS}
        onClose={() => {}}
        onSelect={() => {}}
        onSelectAnnotation={async (target) => {
          jumpedLocation = target.location ?? "";
          return { ok: true, superseded: false };
        }}
        onRemoveBookmark={(id) => {
          removedId = id;
        }}
      />,
    );

    const bookmarkTitle = document.querySelector(
      ".folio-workspace-card__title",
    );
    expect(bookmarkTitle?.textContent).toContain("Part One");

    const jumpBtn = document.querySelector(
      ".folio-workspace-card__main",
    ) as HTMLButtonElement;
    await act(async () => {
      jumpBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(jumpedLocation).toBe("text/part1.xhtml#ch1");

    const removeBtn = document.querySelector(
      ".folio-workspace-card__action",
    ) as HTMLButtonElement;
    act(() => {
      removeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(removedId).toBe("bm-1");
  });

  it("displays highlights and notes with quotes and handles edit/delete in Notes tab", () => {
    let editingNote: Annotation | null = null;
    let deletedId = "";

    render(
      <TocPanel
        open={true}
        initialTab="notes"
        entries={SAMPLE_ENTRIES}
        annotations={SAMPLE_ANNOTATIONS}
        chapters={SAMPLE_CHAPTERS}
        onClose={() => {}}
        onSelect={() => {}}
        onEditNote={(a) => {
          editingNote = a;
        }}
        onDeleteAnnotation={(id) => {
          deletedId = id;
        }}
      />,
    );

    const cards = document.querySelectorAll(
      ".folio-workspace-card--annotation",
    );
    expect(cards.length).toBe(2);

    expect(document.body.textContent).toContain("A memorable sentence.");
    expect(document.body.textContent).toContain("Important plot point.");
    expect(document.body.textContent).toContain("Must remember this twist!");

    const editBtn = document.querySelector(
      "[title='Edit note']",
    ) as HTMLButtonElement;
    expect(editBtn).not.toBeNull();
    act(() => {
      editBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((editingNote as Annotation | null)?.id).toBe("note-1");

    const deleteBtns = Array.from(
      document.querySelectorAll("[title='Delete']"),
    ) as HTMLButtonElement[];
    expect(deleteBtns.length).toBe(2);
    act(() => {
      deleteBtns[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(deletedId).toBe("hl-1");
  });
});
