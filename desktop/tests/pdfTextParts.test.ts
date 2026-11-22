// Pure Phase 3 helpers: D2 permission decision (§7.4/D2), quote matching
// across text-layer spans, and in-book search hit building (§7.6).
import { describe, expect, it } from "vitest";
import { noCopyFromPermissions } from "../src/pdf/permissions";
import {
  bestQuoteOccurrence,
  extractContext,
  matchQuote,
  quoteOccurrences,
} from "../src/pdf/quoteMatch";
import { findPdfSearchHits } from "../src/pdf/pdfSearch";

describe("permissions (D2)", () => {
  it("unencrypted documents are copyable", () => {
    expect(noCopyFromPermissions(null)).toBe(false);
    expect(noCopyFromPermissions(undefined)).toBe(false);
    expect(noCopyFromPermissions(new Set())).toBe(false);
  });

  it("granted COPY keeps copying enabled", () => {
    // print + copy granted, modify refused
    expect(noCopyFromPermissions(new Set([0x04, 0x10]))).toBe(false);
  });

  it("no COPY ⇒ no-copy (accessibility bit is honoured separately)", () => {
    expect(noCopyFromPermissions(new Set([0x04, 0x200]))).toBe(true);
    expect(noCopyFromPermissions(new Set([0x08, 0x100]))).toBe(true);
  });
});

describe("quoteMatch", () => {
  // Realistic text-layer span shapes: items carry their own trailing spaces,
  // split mid-word across spans, and repeat.
  const spans = ["The quick brown ", "fo", "x jumps", " over the lazy dog. ", "The end."];

  it("matches a quote that spans several spans", () => {
    const match = matchQuote(spans, "brown fox jumps");
    expect(match).not.toBeNull();
    expect(match!.startSpan).toBe(0);
    expect(match!.startOffset).toBe(10); // "The quick brown " — 'b' at 10
    expect(match!.endSpan).toBe(2);
    // last matched char is the final 's' of "x jumps"
    expect(spans[match!.endSpan][match!.endOffset]).toBe("s");
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    const match = matchQuote(spans, "the   QUICK   brown fox");
    expect(match).not.toBeNull();
    expect(match!.startSpan).toBe(0);
    expect(match!.startOffset).toBe(0);
  });

  it("rejects quotes the page does not contain", () => {
    expect(matchQuote(spans, "purple elephant")).toBeNull();
    expect(matchQuote(spans, "")).toBeNull();
    expect(matchQuote(["a", "b"], "ab c")).toBeNull();
  });

  it("finds every occurrence left to right", () => {
    const occurrences = quoteOccurrences(spans, "the");
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    // first occurrence starts at "The quick…" (span 0)
    expect(spans[occurrences[0].startSpan][occurrences[0].startOffset].toLowerCase()).toBe("t");
    // the second occurrence is in a later span
    expect(occurrences[1].startSpan).toBeGreaterThan(occurrences[0].startSpan);
    expect(quoteOccurrences(spans, "the", 1)).toHaveLength(1);
  });

  it("maps offsets back to raw span text (whitespace collapsed)", () => {
    const spansWithRuns = ["a  b   c"];
    const match = matchQuote(spansWithRuns, "b c");
    expect(match).not.toBeNull();
    // raw 'b' sits at index 3 in "a  b   c"
    expect(match!.startOffset).toBe(3);
    expect(spansWithRuns[0][match!.endOffset]).toBe("c");
  });

  it("extractContext pulls the ≤32-char neighbourhood", () => {
    const pageText = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa";
    const context = extractContext(pageText, "Gamma Delta");
    expect(context.prefix).toBe("Alpha Beta ");
    // raw 32-char cut (same contract as EPUB: up to 32 chars)
    expect(context.suffix).toBe(" Epsilon Zeta Eta Theta Iota Kap");
    // unknown quote → empty context
    expect(extractContext(pageText, "Omega")).toEqual({ prefix: "", suffix: "" });
  });

  it("maps collapsed-whitespace matches back to raw offsets", () => {
    const pageText = "Alpha   Beta\nGamma   Delta Epsilon";
    const context = extractContext(pageText, "Gamma Delta");
    // Raw text is preserved (including the original whitespace) — only the
    // match index is mapped through the normalised haystack.
    expect(context.prefix).toBe("Alpha   Beta\n");
    expect(context.suffix).toBe(" Epsilon");
  });

  it("picks the repeated quote whose context matches the stored anchor", () => {
    const spans = ["alpha echo beta ", "gamma echo delta"];
    const both = quoteOccurrences(spans, "echo");
    expect(both).toHaveLength(2);
    expect(bestQuoteOccurrence(spans, "echo", { prefix: "gamma ", suffix: " delta" })).toEqual([
      both[1],
    ]);
    // Without context the legacy behaviour paints every occurrence.
    expect(bestQuoteOccurrence(spans, "echo", {})).toHaveLength(2);
  });
});

describe("pdfSearch", () => {
  const pages = [
    { page: 1, text: "The quick brown fox jumps over the lazy dog.", title: "Chapter 1" },
    { page: 2, text: "Pack my box with five dozen liquor jugs.", title: null },
    { page: 3, text: "quick thinking wins quick games", title: "Chapter 3" },
  ];

  it("hits every occurrence in document order", () => {
    const hits = findPdfSearchHits(pages, "quick");
    expect(hits.map((h) => h.page)).toEqual([1, 3, 3]);
    expect(hits.every((h) => h.locator === `page-${h.page}`)).toBe(true);
  });

  it("builds a marked structured snippet", () => {
    const [hit] = findPdfSearchHits(
      [{ page: 1, text: "Tom & <Jerry> run quick today", title: "T" }],
      "quick",
    );
    const marked = hit.snippet.parts.filter((p) => p.mark);
    expect(marked).toHaveLength(1);
    expect(marked[0].text).toBe("quick");
    expect(hit.snippet.head).toBe(false);
    // "Tom & <Jerry> run quick today" is 29 chars — it fits inside the
    // ±48-char window, so there is no trailing ellipsis.
    expect(hit.snippet.tail).toBe(false);
  });

  it("falls back to the page label and honours the cap", () => {
    const [hit] = findPdfSearchHits(pages, "box");
    expect(hit.chapterTitle).toBe("Page 2");
    const capped = findPdfSearchHits(pages, "quick", 2);
    expect(capped).toHaveLength(2);
  });

  it("normalises case/whitespace", () => {
    const hits = findPdfSearchHits(pages, "JUGS");
    expect(hits).toHaveLength(1);
    expect(findPdfSearchHits(pages, "   ")).toEqual([]);
  });
});
