// Background PDF index job (PDF plan §6.4) against the real pdf.js loader.
// Node environment (jsdom has no worker support). Follows the coverCache
// pattern: seed through the libraryUi singleton store with unique slugs.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getLibraryFs, getLibraryManager, LIBRARY_ROOT } from "../src/store/libraryUi";
import { buildSyntheticPdf } from "../src/perf/synthPdf";
import { sha256Hex } from "../src/lib/sha256";
import { newUuid, nowIso } from "../src/model/ids";
import type { DocMeta } from "../src/model/types";
import {
  cancelIndex,
  enqueueIndex,
  indexQueueIdle,
  isIndexQueued,
  reconcileIndexes,
  useIndexJobs,
} from "../src/pdf/pdfIndexJob";

let seq = 0;

async function seedPdf(options: { searchable?: boolean } = {}): Promise<DocMeta> {
  seq += 1;
  const slug = `idx-pdf-${seq}`;
  const lm = getLibraryManager();
  const pdf = buildSyntheticPdf({ pages: 3, title: "Index Me", author: null });
  const meta: DocMeta = {
    schema: 1,
    id: newUuid(),
    slug,
    title: "Index Me",
    author: null,
    kind: "article",
    language: "en",
    sourceFormat: "pdf",
    sourceUrl: null,
    sourceName: "index-me.pdf",
    capturedAt: nowIso(),
    importedAt: nowIso(),
    contentHash: await sha256Hex(pdf),
    wordCount: 36,
    searchable: options.searchable ?? true,
    tags: [],
    collectionIds: [],
    files: { original: null, reading: "reading/book.pdf" },
    chapters: [
      { id: "p1", title: "Page 1", order: 0, href: "page-1" },
      { id: "p2", title: "Page 2", order: 1, href: "page-2" },
      { id: "p3", title: "Page 3", order: 2, href: "page-3" },
    ],
  };
  await lm.addDoc({ meta, files: { "reading/book.pdf": pdf } });
  return meta;
}

describe("pdfIndexJob", () => {
  it("builds a schema-1 page-text index and clears the progress job", async () => {
    const meta = await seedPdf();
    const fs = getLibraryFs();
    expect(isIndexQueued(meta.id)).toBe(false);

    enqueueIndex(meta.id);
    expect(isIndexQueued(meta.id)).toBe(true);
    await indexQueueIdle();

    const raw = await fs.readText(`${LIBRARY_ROOT}/index/text/${meta.id}.json`);
    const index = JSON.parse(raw) as {
      schema: number;
      chapters: { id: string; href: string; title: string; text: string }[];
    };
    expect(index.schema).toBe(1);
    expect(index.chapters.map((c) => c.href)).toEqual(["page-1", "page-2", "page-3"]);
    expect(index.chapters[1].text).toContain("Page 2 of 3");
    expect(isIndexQueued(meta.id)).toBe(false);
    expect(Object.keys(useIndexJobs.getState().jobs)).toEqual([]);
  });

  it("reconcileIndexes enqueues only PDFs with a missing index", async () => {
    const meta = await seedPdf();
    const fs = getLibraryFs();

    // Seed an index so reconcile has nothing to do…
    await fs.writeTextAtomic(`${LIBRARY_ROOT}/index/text/${meta.id}.json`, "{}");
    expect(await reconcileIndexes()).toBe(0);
    await indexQueueIdle();

    // …then remove it: reconcile enqueues and the job rebuilds the index.
    await fs.delete(`${LIBRARY_ROOT}/index/text/${meta.id}.json`);
    expect(await reconcileIndexes()).toBe(1);
    await indexQueueIdle();
    const rebuilt = JSON.parse(await fs.readText(`${LIBRARY_ROOT}/index/text/${meta.id}.json`)) as {
      chapters: unknown[];
    };
    expect(rebuilt.chapters).toHaveLength(3);
  });

  it("reconcileIndexes skips non-searchable (scanned) PDFs", async () => {
    await seedPdf({ searchable: false });
    expect(await reconcileIndexes()).toBe(0);
    await indexQueueIdle();
  });

  it("cancelIndex drops a queued job before it writes", async () => {
    // Two docs: A runs first (~1 s of real extraction); B stays queued behind
    // it, so cancelling B mid-queue is deterministic.
    const a = await seedPdf();
    const b = await seedPdf();
    const fs = getLibraryFs();
    enqueueIndex(a.id);
    enqueueIndex(b.id);
    cancelIndex(b.id);
    await indexQueueIdle();
    // A ran to completion; B was cancelled while queued and never wrote.
    await expect(fs.readText(`${LIBRARY_ROOT}/index/text/${a.id}.json`)).resolves.toBeTruthy();
    await expect(fs.readText(`${LIBRARY_ROOT}/index/text/${b.id}.json`)).rejects.toThrow();
    expect(isIndexQueued(b.id)).toBe(false);
  });
});
