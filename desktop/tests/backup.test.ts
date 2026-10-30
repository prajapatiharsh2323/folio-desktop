import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { MemoryFileStore } from "../src/lib/fileStore";
import { LibraryManager } from "../src/store/libraryManager";
import { parseEpub } from "../src/import/epubImporter";
import { sha256Hex } from "../src/lib/sha256";
import { newUuid, nowIso } from "../src/model/ids";
import type { Annotation, Collection, DocMeta } from "../src/model/types";
import {
  createBackup,
  inspectBackup,
  recoverInterruptedRestore,
  restoreBackup,
} from "../src/backup/backupService";
import { BACKUP_LIMITS, BackupError } from "../src/backup/backupSchema";

const ROOT = "/lib";
const TE = new TextEncoder();

function makeEpub(
  title: string,
  chapters: { id: string; title: string; body: string }[]
): Uint8Array {
  const items = chapters
    .map(
      (c) =>
        `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`
    )
    .join("");
  const spine = chapters.map((c) => `<itemref idref="${c.id}"/>`).join("");
  const zip: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    ),
    "OEBPS/content.opf": strToU8(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:language>en</dc:language></metadata><manifest>${items}</manifest><spine>${spine}</spine></package>`
    ),
  };
  for (const c of chapters) {
    zip[`OEBPS/${c.id}.xhtml`] = strToU8(
      `<html><head><title>${c.title}</title></head><body><h1>${c.title}</h1><p>${c.body}</p></body></html>`
    );
  }
  return zipSync(zip);
}

interface SeedOptions {
  id?: string;
  slug?: string;
  title?: string;
  chapters?: { id: string; title: string; body: string }[];
  /** Override contentHash (used to simulate a different edition). */
  contentHash?: string;
}

async function seedDoc(
  lm: LibraryManager,
  options: SeedOptions = {}
): Promise<{ meta: DocMeta; epub: Uint8Array }> {
  const title = options.title ?? "Moby";
  const epub = makeEpub(title, options.chapters ?? [
    { id: "ch1", title: "Loomings", body: "Call me Ishmael. Some years ago." },
    { id: "ch2", title: "The Spouter", body: "I stuffed a shirt into my trousers." },
  ]);
  const parsed = parseEpub(epub);
  const meta: DocMeta = {
    schema: 1,
    id: options.id ?? newUuid(),
    slug: options.slug ?? "",
    title,
    author: "Herman Melville",
    kind: "book",
    language: "en",
    sourceFormat: "epub",
    sourceUrl: null,
    sourceName: null,
    capturedAt: nowIso(),
    importedAt: nowIso(),
    contentHash: options.contentHash ?? (await sha256Hex(epub)),
    wordCount: 20,
    searchable: true,
    tags: [],
    collectionIds: [],
    files: {
      original: "original/book.epub",
      reading: "reading/book.epub",
    },
    chapters: parsed.chapters.map((c) => ({
      id: c.id,
      title: c.title,
      order: c.order,
      href: c.href,
    })),
  };
  await lm.addDoc({
    meta,
    files: {
      "original/book.epub": epub,
      "reading/book.epub": epub,
    },
  });
  return { meta, epub };
}

async function ensureCollection(
  lm: LibraryManager,
  id: string,
  name: string,
  docId: string
): Promise<void> {
  const list = await lm.collections.list();
  if (!list.some((c) => c.id === id)) {
    const created: Collection = {
      id,
      name,
      docIds: [],
      createdAt: nowIso(),
      updatedAt: null,
    };
    await lm.collections.save([...list, created]);
  }
  await lm.mutateCollectionDocs(id, { add: [docId] });
}

function annotation(overrides: Partial<Annotation>): Annotation {
  return {
    id: newUuid(),
    docId: "",
    quote: "Call me Ishmael.",
    prefix: "",
    suffix: "",
    location: "ch1.xhtml",
    kind: "note",
    color: null,
    note: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
  };
}

function replaceMeta(
  bytes: Uint8Array,
  mutate: (meta: Record<string, unknown>) => void
): Uint8Array {
  const files = unzipSync(bytes);
  const meta = JSON.parse(strFromU8(files["backup.json"])) as Record<string, unknown>;
  mutate(meta);
  files["backup.json"] = strToU8(JSON.stringify(meta));
  return zipSync(files);
}

let fs: MemoryFileStore;
let lm: LibraryManager;

beforeEach(() => {
  fs = new MemoryFileStore();
  lm = new LibraryManager(fs, ROOT);
});

describe("backup export", () => {
  it("writes a v2 archive with a verifiable manifest checksum", async () => {
    await seedDoc(lm);
    const bytes = await createBackup(fs, ROOT);
    const summary = await inspectBackup(bytes);

    expect(summary.schema).toBe(2);
    expect(summary.docCount).toBe(1);
    expect(summary.legacy).toBe(false);
    const files = unzipSync(bytes);
    expect(files["manifest.json"]).toBeDefined();
    expect(files["backup.json"]).toBeDefined();
    expect(Object.keys(files).some((p) => p.startsWith("docs/"))).toBe(true);
  });

  it("excludes derived index files and never re-embeds backup.json", async () => {
    const { meta } = await seedDoc(lm);
    await fs.writeBytesAtomic(
      `/lib/index/text/${meta.id}.json`,
      TE.encode(JSON.stringify({ schema: 1, chapters: [] }))
    );
    await fs.writeBytesAtomic("/lib/backup.json", TE.encode("{}"));

    const files = unzipSync(await createBackup(fs, ROOT));
    expect(Object.keys(files).some((p) => p.startsWith("index/"))).toBe(false);
    expect(files["backup.json"]).toBeDefined();
    expect(JSON.parse(strFromU8(files["backup.json"])).schema).toBe(2);
  });

  it("refuses to export a library with no manifest", async () => {
    await expect(createBackup(fs, ROOT)).rejects.toMatchObject({
      code: "missing-manifest",
    });
  });
});

describe("backup validation", () => {
  it("rejects a non-ZIP file before touching the library", async () => {
    await seedDoc(lm);
    const before = await fs.readBytes("/lib/manifest.json");
    await expect(
      restoreBackup({
        fs,
        root: ROOT,
        bytes: new Uint8Array([1, 2, 3, 4]),
        mode: "replace",
      })
    ).rejects.toMatchObject({ code: "not-zip" });
    expect(await fs.readBytes("/lib/manifest.json")).toEqual(before);
  });

  it("rejects path traversal before any write", async () => {
    await seedDoc(lm);
    const before = await fs.readBytes("/lib/manifest.json");
    const evil = zipSync({
      "../evil.txt": strToU8("nope"),
      "manifest.json": strToU8("{}"),
      "backup.json": strToU8("{}"),
    });
    await expect(
      restoreBackup({ fs, root: ROOT, bytes: evil, mode: "replace" })
    ).rejects.toMatchObject({ code: "unsafe-path" });
    expect(await fs.readBytes("/lib/manifest.json")).toEqual(before);
  });

  it("rejects case-insensitive duplicate paths", async () => {
    await seedDoc(lm);
    const valid = await createBackup(fs, ROOT);
    const base = await inspectBackup(valid);
    const files = unzipSync(valid);
    const meta = JSON.parse(strFromU8(files["backup.json"])) as Record<string, unknown>;
    meta.fileCount = base.fileCount + 1;
    files["backup.json"] = strToU8(JSON.stringify(meta));
    files["docs/DUPLICATE/meta.json"] = files["docs/moby/meta.json"];
    files["docs/duplicate/meta.json"] = files["docs/moby/meta.json"];
    await expect(inspectBackup(zipSync(files))).rejects.toMatchObject({
      code: "duplicate-path",
    });
  });

  it("rejects a manifest checksum mismatch", async () => {
    await seedDoc(lm);
    const bytes = replaceMeta(await createBackup(fs, ROOT), (meta) => {
      meta.manifestSha256 = "0".repeat(64);
    });
    await expect(inspectBackup(bytes)).rejects.toMatchObject({
      code: "hash-mismatch",
    });
  });

  it("rejects a mismatched document count", async () => {
    await seedDoc(lm);
    const bytes = replaceMeta(await createBackup(fs, ROOT), (meta) => {
      meta.docCount = 7;
    });
    await expect(inspectBackup(bytes)).rejects.toMatchObject({
      code: "invalid-metadata",
    });
  });

  it("rejects an unsupported future schema", async () => {
    await seedDoc(lm);
    const bytes = replaceMeta(await createBackup(fs, ROOT), (meta) => {
      meta.schema = 99;
    });
    await expect(inspectBackup(bytes)).rejects.toMatchObject({
      code: "unsupported-schema",
    });
  });

  it("enforces archive limits before extraction", async () => {
    await seedDoc(lm);
    const bytes = await createBackup(fs, ROOT);
    await expect(
      inspectBackup(bytes, { ...BACKUP_LIMITS, maxTotalBytes: 8 })
    ).rejects.toBeInstanceOf(BackupError);
    await expect(
      inspectBackup(bytes, { ...BACKUP_LIMITS, maxEntries: 1 })
    ).rejects.toMatchObject({ code: "too-many-entries" });
  });

  it("reads legacy schema-1 archives", async () => {
    await seedDoc(lm);
    const files = unzipSync(await createBackup(fs, ROOT));
    const v2 = JSON.parse(strFromU8(files["backup.json"])) as Record<string, unknown>;
    files["backup.json"] = strToU8(
      JSON.stringify({
        schema: 1,
        app: "folio",
        createdAt: v2.createdAt,
        manifestSha256: v2.manifestSha256,
      })
    );
    const summary = await inspectBackup(zipSync(files));
    expect(summary.schema).toBe(1);
    expect(summary.legacy).toBe(true);
  });
});

describe("replace restore", () => {
  it("restores docs, user data and search index into an empty library", async () => {
    const { meta } = await seedDoc(lm);
    await ensureCollection(lm, "c1", "Shelf", meta.id);
    await lm.annotations.add(annotation({ id: "a1", docId: meta.id, note: "remember" }));
    await lm.progress.put({
      docId: meta.id,
      location: "ch2.xhtml",
      percent: 42.5,
      updatedAt: nowIso(),
      pace: null,
    });
    await lm.prefs.writeDocOverride(meta.id, {
      ...(await lm.prefs.global()),
      fontSize: 22,
    });

    const bytes = await createBackup(fs, ROOT);
    const target = new MemoryFileStore();
    const result = await restoreBackup({
      fs: target,
      root: ROOT,
      bytes,
      mode: "replace",
    });

    expect(result.addedDocs).toBe(1);
    expect(result.reindexed).toBe(1);
    const restored = new LibraryManager(target, ROOT);
    const manifest = await restored.load();
    expect(manifest?.docs).toHaveLength(1);
    expect((await restored.annotations.list())[0].note).toBe("remember");
    expect((await restored.progress.get(meta.id))?.percent).toBe(42.5);
    expect((await restored.prefs.docOverride(meta.id))?.fontSize).toBe(22);
    expect((await restored.collections.list())[0].docIds).toEqual([meta.id]);
    expect(await target.exists("/lib/backup.json")).toBe(false);
    expect(await target.exists(`/lib/index/text/${meta.id}.json`)).toBe(true);
    const index = JSON.parse(
      await target.readText(`/lib/index/text/${meta.id}.json`)
    );
    expect(index.chapters[0].text).toContain("Ishmael");
  });

  it("keeps the previous library when the swap fails", async () => {
    const { meta } = await seedDoc(lm);
    const bytes = await createBackup(fs, ROOT);

    class FailingMoveStore extends MemoryFileStore {
      failed = false;
      override async move(from: string, to: string): Promise<void> {
        if (!this.failed && from.includes("/restore-") && to === ROOT) {
          this.failed = true;
          throw new Error("simulated rename failure");
        }
        return super.move(from, to);
      }
    }
    const failing = new FailingMoveStore();
    // Copy the library into the failing store.
    for (const path of ["manifest.json", `docs/moby/reading/book.epub`]) {
      if (await fs.exists(`/lib/${path}`)) {
        await failing.writeBytesAtomic(`/lib/${path}`, await fs.readBytes(`/lib/${path}`));
      }
    }
    await failing.writeBytesAtomic(
      "/lib/docs/moby/meta.json",
      await fs.readBytes("/lib/docs/moby/meta.json")
    );

    await expect(
      restoreBackup({ fs: failing, root: ROOT, bytes, mode: "replace" })
    ).rejects.toMatchObject({ code: "staging" });

    expect(await failing.exists("/lib/manifest.json")).toBe(true);
    expect(await failing.exists(`/lib/docs/moby/meta.json`)).toBe(true);
    const manifest = await new LibraryManager(failing, ROOT).load();
    expect(manifest?.docs.some((d) => d.id === meta.id)).toBe(true);
  });

  it("rejects a damaged archive without deleting the library", async () => {
    const { meta } = await seedDoc(lm);
    const manifestBefore = await fs.readBytes("/lib/manifest.json");
    const bytes = await createBackup(fs, ROOT);
    // Drop a file the manifest references.
    const files = unzipSync(bytes);
    delete files["docs/moby/reading/book.epub"];
    const damaged = zipSync(files);

    await expect(
      restoreBackup({ fs, root: ROOT, bytes: damaged, mode: "replace" })
    ).rejects.toBeInstanceOf(BackupError);
    expect(await fs.readBytes("/lib/manifest.json")).toEqual(manifestBefore);
    expect(await fs.exists(`/lib/docs/${meta.slug}/reading/book.epub`)).toBe(true);
  });
});

describe("merge restore", () => {
  it("adds missing docs and unions annotations, progress and collections", async () => {
    // Source library.
    const source = await seedDoc(lm, { id: "src-doc", slug: "shared-book" });
    const extra = await seedDoc(lm, {
      id: "src-extra",
      title: "Extra",
      slug: "extra",
      chapters: [{ id: "e1", title: "E", body: "a book only in the backup" }],
    });
    await ensureCollection(lm, "c1", "Shelf", source.meta.id);
    await lm.annotations.add(
      annotation({
        id: "same",
        docId: source.meta.id,
        note: "newer source note",
        updatedAt: "2026-02-01T00:00:00.000Z",
      })
    );
    await lm.annotations.add(
      annotation({ id: "src-only", docId: source.meta.id, note: "source only" })
    );
    await lm.progress.put({
      docId: source.meta.id,
      location: "ch2.xhtml",
      percent: 60,
      updatedAt: "2026-02-01T00:00:00.000Z",
      pace: null,
    });
    const bytes = await createBackup(fs, ROOT);

    // Target library: same book under a different id (content-hash match),
    // plus an unrelated book and older local user data.
    const targetFs = new MemoryFileStore();
    const target = new LibraryManager(targetFs, ROOT);
    const localBook = await seedDoc(target, {
      id: "local-doc",
      slug: "shared-book",
      contentHash: source.meta.contentHash,
    });
    const otherBook = await seedDoc(target, {
      id: "other-doc",
      title: "Other",
      slug: "other",
      contentHash: "b".repeat(64),
      chapters: [{ id: "x1", title: "X", body: "unrelated text" }],
    });
    await ensureCollection(target, "c1", "Shelf", otherBook.meta.id);
    await target.annotations.add(
      annotation({
        id: "same",
        docId: localBook.meta.id,
        note: "older local note",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
    );
    await target.annotations.add(
      annotation({ id: "local-only", docId: localBook.meta.id, note: "local only" })
    );
    await target.progress.put({
      docId: localBook.meta.id,
      location: "ch1.xhtml",
      percent: 10,
      updatedAt: "2026-01-01T00:00:00.000Z",
      pace: null,
    });

    const result = await restoreBackup({
      fs: targetFs,
      root: ROOT,
      bytes,
      mode: "merge",
    });

    expect(result.mode).toBe("merge");
    // The archive's shared book matches the target by content hash, so only the
    // backup-only book is added; nothing is duplicated.
    expect(result.addedDocs).toBe(1);
    const manifest = await target.load();
    expect(manifest?.docs.map((d) => d.id).sort()).toEqual(
      [localBook.meta.id, otherBook.meta.id, extra.meta.id].sort()
    );

    const annotations = await target.annotations.list();
    expect(annotations.find((a) => a.id === "same")?.note).toBe("newer source note");
    expect(annotations.find((a) => a.id === "same")?.docId).toBe(localBook.meta.id);
    expect(annotations.find((a) => a.id === "src-only")?.docId).toBe(localBook.meta.id);
    expect(annotations.find((a) => a.id === "local-only")).toBeDefined();

    expect((await target.progress.get(localBook.meta.id))?.percent).toBe(60);

    const collections = await target.collections.list();
    expect(collections[0].docIds.sort()).toEqual(
      [localBook.meta.id, otherBook.meta.id].sort()
    );
    expect((await target.meta.read("shared-book"))?.collectionIds).toContain("c1");
  });

  it("reports a conflicting edition instead of overwriting the local book", async () => {
    const source = await seedDoc(lm, { id: "doc-1", slug: "book" });
    const bytes = await createBackup(fs, ROOT);

    const targetFs = new MemoryFileStore();
    const target = new LibraryManager(targetFs, ROOT);
    await seedDoc(target, {
      id: "doc-1",
      slug: "book",
      title: "Book",
      contentHash: "c".repeat(64),
    });

    const result = await restoreBackup({
      fs: targetFs,
      root: ROOT,
      bytes,
      mode: "merge",
    });
    expect(result.conflicts).toBe(1);
    expect(result.skippedDocs).toHaveLength(1);
    const manifest = await target.load();
    expect(manifest?.docs[0].contentHash).toBe("c".repeat(64));
    expect(manifest?.docs[0].id).toBe("doc-1");
    expect(source.meta.id).toBe("doc-1");
  });
});

describe("startup recovery", () => {
  it("moves a rollback tree back when the live root is missing", async () => {
    await seedDoc(lm);
    const before = await fs.readBytes("/lib/manifest.json");
    await fs.move("/lib", "/lib.rollback-123");
    expect(await fs.exists("/lib/manifest.json")).toBe(false);

    const recovered = await recoverInterruptedRestore(fs, ROOT);
    expect(recovered).toBe(true);
    expect(await fs.readBytes("/lib/manifest.json")).toEqual(before);
  });

  it("cleans abandoned staging trees when the live root exists", async () => {
    await seedDoc(lm);
    await fs.writeBytesAtomic("/restore-dead/docs/x", TE.encode("x"));
    const recovered = await recoverInterruptedRestore(fs, ROOT);
    expect(recovered).toBe(false);
    expect(await fs.exists("/restore-dead/docs/x")).toBe(false);
  });

  it("restores the rollback when the live root's manifest is unreadable", async () => {
    await seedDoc(lm);
    const before = await fs.readBytes("/lib/manifest.json");
    await fs.move("/lib", "/lib.rollback-1");
    // A half-written root: present, but no usable manifest.
    await fs.writeBytesAtomic("/lib/manifest.json", TE.encode("{ broken"));

    const recovered = await recoverInterruptedRestore(fs, ROOT);
    expect(recovered).toBe(true);
    expect(await fs.readBytes("/lib/manifest.json")).toEqual(before);
    const rootEntries = await fs.list("/");
    expect(rootEntries.some((e) => e.path.includes("lib.corrupt-"))).toBe(true);
  });

  it("drops a stale rollback once the live root is healthy", async () => {
    await seedDoc(lm);
    await fs.move("/lib", "/lib.rollback-1");
    await fs.move("/lib.rollback-1", "/lib");

    const recovered = await recoverInterruptedRestore(fs, ROOT);
    expect(recovered).toBe(false);
    expect(await fs.exists("/lib/manifest.json")).toBe(true);
    const rootEntries = await fs.list("/");
    expect(rootEntries.some((e) => e.path.includes("lib.rollback-"))).toBe(false);
  });
});
