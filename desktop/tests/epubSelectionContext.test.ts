// Selection context extraction from Readium spine frames: prefix/suffix must
// come from the live DOM range, stay aligned across element boundaries, and
// never invent context for a mismatched quote.
import { describe, it, expect } from "vitest";
import { selectionContext } from "../src/reader/readiumEngine";

function dom(html: string): Document {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = html;
  return doc;
}

function rangeFor(doc: Document, selector: string, start: number, end: number): Range {
  const node = doc.querySelector(selector)!.firstChild!;
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

describe("selectionContext", () => {
  it("extracts prefix/suffix from the containing paragraph", () => {
    const doc = dom("<p>alpha before <em>the quote</em> after omega</p>");
    const ctx = selectionContext(doc, rangeFor(doc, "em", 0, 9), "the quote");
    expect(ctx.prefix).toBe("alpha before ");
    expect(ctx.suffix).toBe(" after omega");
  });

  it("uses the range offsets, not the whole element text", () => {
    const doc = dom("<p>prefix one two three suffix</p>");
    const ctx = selectionContext(doc, rangeFor(doc, "p", 7, 10), "one");
    expect(ctx.prefix.endsWith("prefix ")).toBe(true);
    expect(ctx.suffix.startsWith(" two three suffix")).toBe(true);
  });

  it("clips context to the requested width", () => {
    const doc = dom(`<p>${"a".repeat(80)}TARGET${"b".repeat(80)}</p>`);
    const node = doc.querySelector("p")!.firstChild!;
    const range = doc.createRange();
    range.setStart(node, 80);
    range.setEnd(node, 86);
    const ctx = selectionContext(doc, range, "TARGET");
    expect(ctx.prefix).toBe("a".repeat(32));
    expect(ctx.suffix).toBe("b".repeat(32));
  });

  it("returns empty context when the range cannot be resolved", () => {
    const doc = dom("<p>text</p>");
    const range = doc.createRange();
    expect(selectionContext(doc, range, "text")).toEqual({ prefix: "", suffix: "" });
  });
});
