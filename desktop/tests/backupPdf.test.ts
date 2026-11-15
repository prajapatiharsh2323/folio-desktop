// Backup round trip with a PDF document in the library (PDF plan §6.5).
// Node environment: restore runs reindexDocs, whose PDF branch loads pdf.js
// (jsdom has no worker support).
// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import { LibraryManager } from "../src/store/libraryManager";
import { sha256Hex } from "../src/lib/sha256";
import { newUuid, nowIso } from "../src/model/ids";
import type { DocMeta } from "../src/model/types";
import { createBackup, inspectBackup, restoreBackup } from "../src/backup/backupService";
import { buildSyntheticPdf } from "../src/perf/synthPdf";

const ROOT = "/lib";

async function seedPdf(lm: LibraryManager, slug: string): Promise<DocMeta> {
  const pdf = buildSyntheticPdf({ pages: 3, title: "Backed Up PDF", author: "A. Writer" });
  const meta: DocMeta = {
    schema: 1,
    id: newUuid(),
    slug,
    title: "Backed Up PDF",
    author: "A. Writer",
    kind: "article", // < 20 pages (D3)
    language: "en",
    sourceFormat: "pdf",
    sourceUrl: null,
    sourceName: "backed-up.pdf",
    capturedAt: nowIso(),
    importedAt: nowIso(),
    contentHash: await sha256Hex(pdf),
    wordCount: 36,
    searchable: true,
    tags: [],
    collectionIds: [],
    // PDFs keep one copy under reading/ (plan §5): original stays null.
    files: {
      original: null,
      reading: "reading/book.pdf",
    },
    chapters: [
      { id: "p1", title: "Page 1", order: 0, href: "page-1" },
      { id: "p2", title: "Page 2", order: 1, href: "page-2" },
      { id: "p3", title: "Page 3", order: 2, href: "page-3" },
    ],
  };
  await lm.addDoc({
    meta,
    files: { "reading/book.pdf": pdf },
  });
  return meta;
}

describe("backup round trip with a PDF", () => {
  let source: MemoryFileStore;
  beforeEach(() => {
    source = new MemoryFileStore();
  });

  it("archives, warns about PDFs (D1), restores bytes and rebuilds the index", async () => {
    const lmA = new LibraryManager(source, ROOT);
    const meta = await seedPdf(lmA, "backed-up-pdf");

    const archive = { bytes: await createBackup(source, ROOT) };
    const summary = await inspectBackup(archive.bytes);
    expect(summary.docCount).toBe(1);
    expect(
      summary.warnings.some((w) =>
        w.includes("Includes 1 PDF document; Folio Mobile may not open them yet."),
      ),
    ).toBe(true);

    const target = new MemoryFileStore();
    const result = await restoreBackup({
      fs: target,
      root: ROOT,
      bytes: archive.bytes,
      mode: "replace",
    });
    expect(result.addedDocs).toBe(1);
    expect(result.reindexFailures).toEqual([]);

    const lmB = new LibraryManager(target, ROOT);
    const restoredSlug = await slugFrom(target);
    const restored = await lmB.meta.read(restoredSlug);
    expect(restored?.sourceFormat).toBe("pdf");
    expect(restored?.files).toEqual({
      original: null,
      reading: "reading/book.pdf",
    });

    // The reading copy survived byte-for-byte.
    const bytes = await target.readBytes(`${ROOT}/docs/${restoredSlug}/reading/book.pdf`);
    expect(bytes.length).toBeGreaterThan(0);

    // reindexDocs rebuilt a page-text index from the restored PDF.
    const index = JSON.parse(await target.readText(`/lib/index/text/${meta.id}.json`)) as {
      schema: number;
      chapters: { id: string; href: string; text: string }[];
    };
    expect(index.schema).toBe(1);
    expect(index.chapters.map((c) => c.href)).toEqual(["page-1", "page-2", "page-3"]);
    expect(index.chapters[0].text).toContain("Page 1 of 3");
  });
});

async function slugFrom(fs: MemoryFileStore): Promise<string> {
  // The manifest is written last; after a successful restore it is readable.
  const manifest = JSON.parse(await fs.readText(`${ROOT}/manifest.json`)) as {
    docs: { slug: string }[];
  };
  return manifest.docs[0].slug;
}
