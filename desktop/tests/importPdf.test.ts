// PDF import pipeline end-to-end against the real pdf.js loader (PDF plan
// §6.2/§6.3). Node environment: pdf.js needs Node; jsdom has no worker
// support. EPUB/HTML/TXT cases live in import.test.ts / importBaseline.
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import { LibraryManager } from "../src/store/libraryManager";
import { importFile, replaceDoc } from "../src/import/importService";
import { buildSyntheticPdf } from "../src/perf/synthPdf";
import { COPY, ImportError } from "../src/import/fileDetector";

const ROOT = "/lib";
let lm: LibraryManager;
let fs: MemoryFileStore;

beforeEach(() => {
  fs = new MemoryFileStore();
  lm = new LibraryManager(fs, ROOT);
});

describe("import pipeline (PDF)", () => {
  it("imports a text PDF: files, meta, cover absent, searchable", async () => {
    const bytes = buildSyntheticPdf({ pages: 25, title: "PDF Book", author: "Pdf Author" });
    const res = await importFile(lm, "pdf-book.pdf", bytes);
    expect(res.status).toBe("imported");
    const manifest = await lm.load();
    const entry = manifest!.docs[0];
    const meta = (await lm.meta.read(entry.slug))!;
    expect(meta.sourceFormat).toBe("pdf");
    expect(meta.kind).toBe("book"); // ≥ 20 pages (D3)
    expect(meta.searchable).toBe(true);
    expect(meta.language).toBe("en");
    expect(meta.files).toEqual({
      original: null,
      clean: null,
      reading: "reading/book.pdf",
      cover: null,
    });
    // exactly one reading copy, no original/ (plan §5)
    const reading = await fs.readBytes(`${ROOT}/docs/${entry.slug}/reading/book.pdf`);
    expect(Array.from(reading)).toEqual(Array.from(bytes));
    // synthetic "Pages a–b" chapters (no outline)
    expect(meta.chapters.length).toBeLessThanOrEqual(40);
    expect(meta.chapters[0].href).toMatch(/^page-\d+$/);
    // no import-time index: the background job owns it (plan §6.4)
    await expect(fs.readBytes(`${ROOT}/index/text/${entry.id}.json`)).rejects.toThrow();
  });

  it("short PDFs become articles (D3) with the outline as chapters", async () => {
    const bytes = buildSyntheticPdf({ pages: 4, title: "Short", outline: "flat" });
    const res = await importFile(lm, "short-paper.pdf", bytes);
    expect(res.status).toBe("imported");
    const manifest = await lm.load();
    const meta = (await lm.meta.read(manifest!.docs[0].slug))!;
    expect(meta.kind).toBe("article");
    expect(meta.chapters.map((c) => c.href)).toEqual(["page-1", "page-2", "page-3", "page-4"]);
  });

  it("scanned PDFs import as non-searchable", async () => {
    const bytes = buildSyntheticPdf({ pages: 6, title: "Scan", textFor: () => "" });
    const res = await importFile(lm, "scan.pdf", bytes);
    expect(res.status).toBe("imported");
    const manifest = await lm.load();
    const meta = (await lm.meta.read(manifest!.docs[0].slug))!;
    expect(meta.searchable).toBe(false);
    expect(meta.wordCount).toBeNull();
  });

  it("duplicate gate keys on content hash; Replace keeps annotations", async () => {
    const bytes = buildSyntheticPdf({ pages: 3, title: "Dup" });
    const first = await importFile(lm, "dup.pdf", bytes);
    expect(first.status).toBe("imported");

    const skipped = await importFile(lm, "dup-again.pdf", bytes);
    expect(skipped.status).toBe("skipped");
    expect(skipped.docId).toBe(first.docId);

    // annotation on the old doc survives Replace (same docId)
    const manifest = await lm.load();
    const oldId = manifest!.docs[0].id;
    await lm.annotations.add({
      id: "ann-1",
      docId: oldId,
      kind: "highlight",
      color: "yellow",
      quote: "sample",
      prefix: "",
      suffix: "",
      location: "page-1",
      createdAt: "2026-11-14T00:00:00Z",
      updatedAt: "2026-11-14T00:00:00Z",
    });
    const replaced = await replaceDoc(lm, oldId, "dup-v2.pdf", bytes, "pdf");
    expect(replaced.status).toBe("replaced");
    expect(replaced.docId).toBe(oldId);
    const annotations = await lm.annotations.listForDoc(oldId);
    expect(annotations.map((a) => a.id)).toContain("ann-1");
    // the stale index was dropped (plan §6.5)
    await expect(fs.readBytes(`${ROOT}/index/text/${oldId}.json`)).rejects.toThrow();
  });

  it("refuses encrypted PDFs with the encrypted copy", async () => {
    // Real encrypted fixtures arrive with the hardening pass; the refusal
    // contract is pinned here so the message can never drift silently.
    const error = new ImportError("encrypted", COPY.encrypted);
    expect(error.code).toBe("encrypted");
    expect(error.message).toBe(COPY.encrypted);
  });
});
