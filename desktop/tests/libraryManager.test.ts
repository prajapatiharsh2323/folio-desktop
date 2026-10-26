import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import { LibraryManager } from "../src/store/libraryManager";
import type { DocMeta } from "../src/model/types";
import { newUuid, nowIso } from "../src/model/ids";

const ROOT = "/lib";

let fs: MemoryFileStore & { ops: string[] };

function tracked(): MemoryFileStore & { ops: string[] } {
  const base = new MemoryFileStore();
  const trackedFs = base as MemoryFileStore & { ops: string[] };
  trackedFs.ops = [];
  const wrap = (name: keyof MemoryFileStore) => {
    const orig = (base[name] as (...a: unknown[]) => Promise<unknown>).bind(base);
    (trackedFs as unknown as Record<string, unknown>)[name] = async (...a: unknown[]) => {
      trackedFs.ops.push(`${name}:${String(a[0])}`);
      return orig(...a);
    };
  };
  wrap("writeTextAtomic");
  wrap("writeBytesAtomic");
  wrap("delete");
  return trackedFs;
}

function makeMeta(overrides: Partial<DocMeta> = {}): DocMeta {
  return {
    schema: 1,
    id: newUuid(),
    slug: "",
    title: "A Book Title",
    author: "An Author",
    kind: "book",
    language: "en",
    sourceFormat: "epub",
    sourceUrl: null,
    sourceName: null,
    capturedAt: nowIso(),
    importedAt: nowIso(),
    contentHash: "a".repeat(64),
    wordCount: 1000,
    searchable: true,
    tags: [],
    collectionIds: [],
    files: { original: "original/book.epub", reading: "reading/book.epub" },
    chapters: [{ id: "ch1", title: "Chapter 1", order: 0, href: "ch1.xhtml" }],
    ...overrides,
  };
}

async function addSampleDoc(
  lm: LibraryManager,
  overrides: Partial<DocMeta> = {}
): Promise<DocMeta> {
  const meta = makeMeta(overrides);
  await lm.addDoc({
    meta,
    files: {
      "original/book.epub": new TextEncoder().encode("fake epub"),
      "reading/book.epub": new TextEncoder().encode("reading edition"),
    },
  });
  return meta;
}

describe("LibraryManager sticky rules (05 §4)", () => {
  beforeEach(() => {
    fs = tracked();
  });

  it("addDoc writes data files + meta first, manifest LAST (commit point)", async () => {
    const lm = new LibraryManager(fs, ROOT);
    await addSampleDoc(lm);
    const writes = fs.ops.filter((o) => o.startsWith("write"));
    const last = writes[writes.length - 1];
    expect(last).toContain("manifest.json");
    // meta.json must precede the manifest
    expect(writes.findIndex((w) => w.includes("meta.json"))).toBeLessThan(
      writes.length - 1
    );
  });

  it("manifest gains the doc with sha256 + size entries", async () => {
    const lm = new LibraryManager(fs, ROOT);
    const meta = await addSampleDoc(lm);
    const manifest = await lm.load();
    expect(manifest).not.toBeNull();
    expect(manifest!.schema).toBe(1);
    expect(manifest!.app).toBe("folio");
    const doc = manifest!.docs.find((d) => d.id === meta.id)!;
    expect(doc.slug).toBe("a-book-title");
    const reading = doc.files.find((f) => f.path.endsWith("reading/book.epub"))!;
    expect(reading.sha256).toHaveLength(64);
    expect(reading.size).toBe("reading edition".length);
  });

  it("deleteDoc cascades: folder, index, annotations, progress, collections — manifest last", async () => {
    const lm = new LibraryManager(fs, ROOT);
    const meta = await addSampleDoc(lm);
    const col = await lm.createCollection("Shelf");
    await lm.mutateCollectionDocs(col.id, { add: [meta.id] });
    await lm.annotations.add({
      id: newUuid(),
      docId: meta.id,
      quote: "text",
      prefix: "",
      suffix: "",
      kind: "highlight",
      color: "green",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await lm.progress.put({
      docId: meta.id,
      location: "epubcfi(/6/4)",
      percent: 5,
      updatedAt: nowIso(),
      pace: null,
    });

    fs.ops = [];
    await lm.deleteDoc(meta.id);

    expect(await lm.meta.exists("a-book-title")).toBe(false);
    expect((await lm.annotations.list()).length).toBe(0);
    expect(await lm.progress.get(meta.id)).toBeNull();
    const cols = await lm.collections.list();
    expect(cols[0].docIds).toEqual([]);
    // per-doc settings override removed
    expect(await lm.prefs.docOverride(meta.id)).toBeNull();
    // manifest last
    const writes = fs.ops.filter((o) => o.startsWith("write"));
    expect(writes[writes.length - 1]).toContain("manifest.json");
    expect((await lm.load())!.docs.find((d) => d.id === meta.id)).toBeUndefined();
  });

  it("setDocCollections dual-writes both sides (05 §4 invariant 1)", async () => {
    const lm = new LibraryManager(fs, ROOT);
    const meta = await addSampleDoc(lm);
    const c1 = await lm.createCollection("One");
    const c2 = await lm.createCollection("Two");

    await lm.setDocCollections(meta.id, [c1.id]);
    let stored = await lm.meta.read("a-book-title");
    expect(stored!.collectionIds).toEqual([c1.id]);
    let cols = await lm.collections.list();
    expect(cols.find((c) => c.id === c1.id)!.docIds).toEqual([meta.id]);
    expect(cols.find((c) => c.id === c2.id)!.docIds).toEqual([]);

    // flip to c2 only
    await lm.setDocCollections(meta.id, [c2.id]);
    stored = await lm.meta.read("a-book-title");
    expect(stored!.collectionIds).toEqual([c2.id]);
    cols = await lm.collections.list();
    expect(cols.find((c) => c.id === c1.id)!.docIds).toEqual([]);
    expect(cols.find((c) => c.id === c2.id)!.docIds).toEqual([meta.id]);
  });

  it("mutateCollectionDocs keeps both sides in sync", async () => {
    const lm = new LibraryManager(fs, ROOT);
    const meta = await addSampleDoc(lm);
    const col = await lm.createCollection("Shelf");
    await lm.mutateCollectionDocs(col.id, { add: [meta.id] });
    expect((await lm.meta.read("a-book-title"))!.collectionIds).toEqual([col.id]);
    await lm.mutateCollectionDocs(col.id, { remove: [meta.id] });
    expect((await lm.meta.read("a-book-title"))!.collectionIds).toEqual([]);
  });

  it("deleteCollection drops the id from docmeta (dual-write)", async () => {
    const lm = new LibraryManager(fs, ROOT);
    const meta = await addSampleDoc(lm);
    const col = await lm.createCollection("Shelf");
    await lm.mutateCollectionDocs(col.id, { add: [meta.id] });
    await lm.deleteCollection(col.id);
    expect(await lm.collections.list()).toEqual([]);
    expect((await lm.meta.read("a-book-title"))!.collectionIds).toEqual([]);
  });

  it("prefs: doc override merges over global; reset removes only the override", async () => {
    const lm = new LibraryManager(fs, ROOT);
    await lm.prefs.writeGlobal({
      ...(await lm.prefs.global()),
      theme: "warm",
      fontSize: 20,
    });
    await lm.prefs.writeDocOverride("d1", {
      ...(await lm.prefs.global()),
      fontSize: 24,
    });
    expect((await lm.prefs.resolved("d1")).fontSize).toBe(24);
    expect((await lm.prefs.resolved("d1")).theme).toBe("warm");
    expect((await lm.prefs.resolved("other")).fontSize).toBe(20);

    await lm.prefs.removeDocOverride("d1");
    expect(await lm.prefs.docOverride("d1")).toBeNull();
    expect((await lm.prefs.resolved("d1")).fontSize).toBe(20);
  });

  it("slug collision on import resolves with -2", async () => {
    const lm = new LibraryManager(fs, ROOT);
    const m1 = await addSampleDoc(lm);
    expect(m1.slug).toBe("a-book-title");
    const m2 = await addSampleDoc(lm);
    expect(m2.slug).toBe("a-book-title-2");
  });
});
