// R5 highlight overlap decisions: re-highlighting a span must update or
// toggle the existing annotation, never create an overlapping duplicate.
import { describe, it, expect } from "vitest";
import {
  chapterOf,
  findOverlappingHighlight,
  highlightAction,
  quotesOverlap,
} from "../src/screens/reader/annotationOverlap";
import type { Annotation } from "../src/model/types";

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    docId: "d1",
    chapterId: null,
    quote: "the quoted line",
    prefix: "",
    suffix: "",
    location: "ch1.xhtml?p=0.2#frag",
    kind: "highlight",
    color: "yellow",
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("chapterOf", () => {
  it("reads the resource href out of a stored location", () => {
    expect(chapterOf("OEBPS/ch1.xhtml?p=0.2#frag")).toBe("OEBPS/ch1.xhtml");
  });

  it("returns null for missing or CFI locations", () => {
    expect(chapterOf(null)).toBeNull();
    expect(chapterOf("")).toBeNull();
    expect(chapterOf("epubcfi(/6/4)")).toBeNull();
  });
});

describe("quotesOverlap", () => {
  it("matches containment either way, case-insensitively", () => {
    expect(quotesOverlap("The quoted line", "quoted")).toBe(true);
    expect(quotesOverlap("line", "The quoted line")).toBe(true);
    expect(quotesOverlap("THE QUOTED LINE", "the quoted line")).toBe(true);
  });

  it("does not match disjoint text or blanks", () => {
    expect(quotesOverlap("the quoted line", "something else")).toBe(false);
    expect(quotesOverlap("", "x")).toBe(false);
    expect(quotesOverlap("   ", "the quoted line")).toBe(false);
  });
});

describe("findOverlappingHighlight", () => {
  it("finds a same-chapter highlight containing the selection", () => {
    const list = [
      annotation({ id: "bookmark", kind: "bookmark", quote: "" }),
      annotation({ id: "note", kind: "note", quote: "the quoted line" }),
      annotation({ id: "h1", quote: "the quoted line", color: "blue" }),
    ];
    expect(findOverlappingHighlight(list, "ch1.xhtml?p=0.2#frag", "quoted")?.id).toBe("h1");
  });

  it("ignores the same quote in a different chapter", () => {
    const list = [annotation({ id: "h1", location: "ch2.xhtml?p=0.5" })];
    expect(findOverlappingHighlight(list, "ch1.xhtml?p=0.2#frag", "quoted")).toBeNull();
  });

  it("matches when the stored quote is inside the selection", () => {
    const list = [annotation({ id: "h1", quote: "quoted" })];
    expect(findOverlappingHighlight(list, "ch1.xhtml?p=0.2#frag", "the quoted line")?.id).toBe(
      "h1",
    );
  });
});

describe("highlightAction", () => {
  it("creates without an existing highlight", () => {
    expect(highlightAction(null, "yellow")).toBe("create");
  });

  it("toggles off the same colour and recolours a different one", () => {
    const existing = annotation({ color: "blue" });
    expect(highlightAction(existing, "blue")).toBe("toggle-off");
    expect(highlightAction(existing, "pink")).toBe("recolour");
  });
});
