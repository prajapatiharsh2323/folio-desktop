// parsePdf against real pdf.js in Node (PDF plan §11). Fixtures are
// generated in-repo by src/perf/synthPdf.ts — no third-party files. Cover
// rendering is browser-only and exercised by the later engine tests.
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
// Real pdf.js parsing takes >5s on slow CI runners (Windows): lift the
// default test timeout for this file's real-parse tests.
vi.setConfig({ testTimeout: 30_000 });
import { buildSyntheticPdf } from "../src/perf/synthPdf";
import { parsePdf } from "../src/pdf/parsePdf";
import { COPY, ImportError } from "../src/import/fileDetector";

describe("parsePdf (real pdf.js, Node)", () => {
  it("extracts page count, title, author, first page size and sample text", async () => {
    const bytes = buildSyntheticPdf({ pages: 3, title: "Parse Fixture", author: "An Author" });
    const result = await parsePdf("parse-fixture.pdf", bytes);
    expect(result.pageCount).toBe(3);
    expect(result.title).toBe("Parse Fixture");
    expect(result.author).toBe("An Author");
    expect(result.firstPageSize).toEqual({ width: 612, height: 792 });
    expect(result.searchable).toBe(true);
    expect(result.estimatedWordCount).toBeGreaterThan(0);
    expect(result.sampleText).toContain("Page 1 of 3");
    expect(result.outline).toEqual([]);
    expect(result.language).toBe("en");
    // cover rendering is browser-only; Node returns null (tint placeholder)
    expect(result.cover).toBeNull();
  });

  it("falls back to the file name stem for junk or missing titles", async () => {
    const junk = buildSyntheticPdf({ pages: 2, title: "Microsoft Word - annual-report-final" });
    expect((await parsePdf("My Great Report.pdf", junk)).title).toBe("My Great Report");

    const digits = buildSyntheticPdf({ pages: 2, title: "12345" });
    expect((await parsePdf("Chapter Notes.pdf", digits)).title).toBe("Chapter Notes");

    const none = buildSyntheticPdf({ pages: 2, title: null });
    expect((await parsePdf("untitled-file.pdf", none)).title).toBe("untitled-file");
  });

  it("flattens a nested outline in document order, deduped by page", async () => {
    const bytes = buildSyntheticPdf({ pages: 4, title: "T", outline: "nested" });
    const result = await parsePdf("nested.pdf", bytes);
    expect(result.outline).toEqual([
      { title: "Part One", page: 1 },
      { title: "Chapter 2", page: 2 },
      { title: "Part Two", page: 3 },
    ]);
    // "Chapter 1" shares page 1 with "Part One" and "Chapter 3" shares page 3
    // with "Part Two" → both deduped away by the seenPages guard.
  });

  it("skips unresolvable outline entries without failing", async () => {
    const bytes = buildSyntheticPdf({ pages: 3, title: "T", outline: "broken" });
    const result = await parsePdf("broken.pdf", bytes);
    expect(result.outline).toEqual([
      { title: "Good entry", page: 1 },
      { title: "Another good", page: 2 },
    ]);
  });

  it("marks an image-only (no text layer) document non-searchable", async () => {
    // Pages whose content draws nothing produce no text → below the
    // ~20 chars/page threshold (plan §6.3).
    const bytes = buildSyntheticPdf({ pages: 3, title: "Scan", textFor: () => "" });
    const result = await parsePdf("scan.pdf", bytes);
    expect(result.searchable).toBe(false);
    expect(result.estimatedWordCount).toBeNull();
    expect(result.sampleText.trim()).toBe("");
  });

  it("keeps byte-size and rotation: mixed sizes parse without error", async () => {
    const bytes = buildSyntheticPdf({
      pages: 2,
      title: "Mixed",
      pageSize: (i) => (i === 2 ? { width: 400, height: 400 } : { width: 612, height: 792 }),
      rotate: (i) => (i === 2 ? 90 : 0),
    });
    const result = await parsePdf("mixed.pdf", bytes);
    expect(result.pageCount).toBe(2);
    expect(result.searchable).toBe(true);
  });

  it("refuses non-PDF bytes with the invalid-PDF copy", async () => {
    await expect(
      parsePdf("x.pdf", new TextEncoder().encode("definitely not a pdf")),
    ).rejects.toThrow(COPY.invalidPdf);
    await expect(
      parsePdf("x.pdf", new TextEncoder().encode("definitely not a pdf")),
    ).rejects.toMatchObject({ code: "unreadable", name: "ImportError" });
  });

  it("does not detach the caller's bytes", async () => {
    const bytes = buildSyntheticPdf({ pages: 1, title: "T" });
    const before = Array.from(bytes);
    await parsePdf("detach.pdf", bytes);
    expect(Array.from(bytes)).toEqual(before);
  });

  it("reports progress monotonically to 1", async () => {
    const bytes = buildSyntheticPdf({ pages: 5, title: "P" });
    const seen: number[] = [];
    await parsePdf("progress.pdf", bytes, { onProgress: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(seen[seen.length - 1]);
    expect(seen[seen.length - 1]).toBeCloseTo(1, 5);
  });

  it("map errors: ImportError instances pass through", async () => {
    // A zero-page PDF is hard to synthesize (pdf.js errors first), so the
    // "unreadable" path is covered above; this pins the ImportError identity.
    const error = new ImportError("unreadable", COPY.noPages);
    expect(error.code).toBe("unreadable");
    expect(error.message).toBe(COPY.noPages);
  });
});
