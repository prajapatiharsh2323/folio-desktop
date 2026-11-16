// N1: pure notes-export builders (CSV + Markdown) and CSV quoting.
import { describe, expect, it } from "vitest";
import { buildNotesCsv, buildNotesMarkdown, csvField } from "../src/screens/NotesScreen";
import type { Annotation } from "../src/model/types";

function ann(partial: Partial<Annotation> & { id: string }): Annotation {
  return {
    docId: "d1",
    quote: "A quoted line",
    prefix: "",
    suffix: "",
    location: null,
    kind: "highlight",
    color: "yellow",
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("csvField", () => {
  it("leaves plain fields bare", () => {
    expect(csvField("plain")).toBe("plain");
  });

  it("quotes fields with commas, quotes or newlines and doubles quotes", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildNotesCsv", () => {
  const titleOf = () => "Dune";
  const chapterOf = () => null;

  it("emits the header then one row per annotation", () => {
    const csv = buildNotesCsv(
      [
        ann({ id: "a1", kind: "highlight", color: "yellow", quote: "Fear is the mind-killer" }),
        ann({ id: "a2", kind: "note", color: "pink", quote: "", note: 'a note, with "quotes"' }),
      ],
      titleOf,
      chapterOf,
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "book,kind,color,quote,prefix,suffix,note,chapter,created,updated,location",
    );
    expect(lines[1]).toContain("Dune,Highlight,yellow,Fear is the mind-killer");
    // The note with a comma + quotes must stay one quoted field.
    expect(lines[2]).toContain('"a note, with ""quotes"""');
  });

  it("chapter names land in the chapter column when resolvable", () => {
    const csv = buildNotesCsv([ann({ id: "a1" })], titleOf, () => "Chapter 1");
    expect(csv.split("\n")[1]).toContain(",Chapter 1,2026-01-01");
  });
});

describe("buildNotesMarkdown", () => {
  it("groups by book with an H2 and one bullet per annotation", () => {
    const md = buildNotesMarkdown(
      [
        {
          docId: "d1",
          title: "Dune",
          missing: false,
          items: [
            ann({ id: "a1", quote: "Fear is the mind-killer", note: null }),
            ann({ id: "a2", kind: "note", quote: "", note: "My thought" }),
          ],
        },
      ],
      () => null,
    );
    expect(md).toContain("# Folio notes");
    expect(md).toContain("## Dune");
    expect(md).toContain("- **Highlight** — “Fear is the mind-killer” — ");
    expect(md).toContain("- **Note** — My thought — ");
  });

  it("omits the chapter segment when unknown and includes it when given", () => {
    const withChapter = buildNotesMarkdown(
      [{ docId: "d1", title: "Dune", missing: false, items: [ann({ id: "a1" })] }],
      () => "Chapter 2",
    );
    expect(withChapter).toContain("Chapter 2 ·");

    const withoutChapter = buildNotesMarkdown(
      [{ docId: "d1", title: "Dune", missing: false, items: [ann({ id: "a1" })] }],
      () => null,
    );
    expect(withoutChapter).not.toContain("Chapter 2");
  });
});
