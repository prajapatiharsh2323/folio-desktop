// Step 3.3 (L1+L2+L3): pure library sorts, meta cache keyed by the manifest's
// per-doc updatedAt, and the incremental post-import row patch (refreshDocs).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLibraryFs, LIBRARY_ROOT, useLibraryUi, type LibraryRow } from "../src/store/libraryUi";
import { sortLibraryRows } from "../src/lib/libraryView";
import { LibraryManager } from "../src/store/libraryManager";

function row(partial: Partial<LibraryRow> & { id: string }): LibraryRow {
  return {
    slug: partial.id,
    title: partial.id,
    author: null,
    kind: "book",
    percent: null,
    tint: 0,
    importedAt: "",
    activityAt: "",
    tags: [],
    lastReadAt: null,
    minutesLeft: null,
    ...partial,
  };
}

describe("sortLibraryRows", () => {
  it("recent activity uses the later of last-read and imported-at", () => {
    const rows = [
      row({ id: "a", importedAt: "2026-01-01T00:00:00Z", activityAt: "2026-01-01T00:00:00Z" }),
      // read long ago but imported later: import wins
      row({ id: "b", importedAt: "2026-05-01T00:00:00Z", activityAt: "2026-05-01T00:00:00Z" }),
      // imported early but read recently: the read wins
      row({ id: "c", importedAt: "2026-01-02T00:00:00Z", activityAt: "2026-06-01T00:00:00Z" }),
    ];
    expect(sortLibraryRows(rows, "recent").map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("date added is import time desc", () => {
    const rows = [
      row({ id: "old", importedAt: "2026-01-01T00:00:00Z", activityAt: "" }),
      row({ id: "new", importedAt: "2026-03-01T00:00:00Z", activityAt: "" }),
    ];
    expect(sortLibraryRows(rows, "dateadded").map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("progress puts furthest-along first and New last", () => {
    const rows = [
      row({ id: "half", percent: 0.5 }),
      row({ id: "new", percent: null }),
      row({ id: "done", percent: 1 }),
    ];
    expect(sortLibraryRows(rows, "progress").map((r) => r.id)).toEqual(["done", "half", "new"]);
  });

  it("title sort is numeric and case-insensitive (Book 10 after Book 9)", () => {
    const rows = [
      row({ id: "t3", title: "book 10" }),
      row({ id: "t1", title: "Book 9" }),
      row({ id: "t2", title: "book 2" }),
    ];
    expect(sortLibraryRows(rows, "title").map((r) => r.id)).toEqual(["t2", "t1", "t3"]);
  });

  it("author sort puts unnamed authors last", () => {
    const rows = [
      row({ id: "anon", author: null }),
      row({ id: "zeta", author: "Zoe" }),
      row({ id: "beta", author: "Ann" }),
    ];
    expect(sortLibraryRows(rows, "author").map((r) => r.id)).toEqual(["beta", "zeta", "anon"]);
  });
});

describe("library refresh (L1/L2)", () => {
  let lm: LibraryManager;
  let fs: ReturnType<typeof getLibraryFs>;

  beforeEach(() => {
    useLibraryUi.setState({
      rows: [],
      loading: false,
      refreshing: false,
      error: null,
      recovery: null,
      lastImportedIds: [],
    });
    fs = getLibraryFs();
    lm = new LibraryManager(fs, LIBRARY_ROOT);
  });

  afterEach(async () => {
    await fs.delete(LIBRARY_ROOT);
    useLibraryUi.setState({ rows: [], loading: false, refreshing: false, error: null });
  });

  async function seedDoc(slug: string, title: string, author: string | null, updatedAt: string) {
    await lm.addDoc({
      meta: {
        schema: 1,
        id: `doc-${slug}`,
        slug: "",
        title,
        author,
        kind: "book",
        language: "en",
        sourceFormat: "epub",
        sourceUrl: null,
        sourceName: null,
        capturedAt: updatedAt,
        importedAt: updatedAt,
        contentHash: `hash-${slug}`,
        wordCount: null,
        searchable: true,
        tags: [],
        collectionIds: [],
        files: { original: null, clean: null, reading: "reading/book.epub", cover: null },
        chapters: [],
      },
      files: { "reading/book.epub": new Uint8Array([1]) },
    });
    // Pin the manifest doc.updatedAt so the meta-cache key is deterministic.
    const manifest = JSON.parse(await fs.readText(`${LIBRARY_ROOT}/manifest.json`));
    for (const d of manifest.docs) if (d.slug === slug) d.updatedAt = updatedAt;
    await fs.writeTextAtomic(`${LIBRARY_ROOT}/manifest.json`, JSON.stringify(manifest));
  }

  it("caches meta reads until the manifest's doc.updatedAt changes", async () => {
    await seedDoc("cached", "Cached", "Old Author", "2026-01-01T00:00:00Z");
    await useLibraryUi.getState().refresh();
    expect(useLibraryUi.getState().rows[0].author).toBe("Old Author");

    // Rewrite meta.json WITHOUT touching the manifest: the cache must hold.
    const meta = JSON.parse(await fs.readText(`${LIBRARY_ROOT}/docs/cached/meta.json`));
    meta.author = "Sneaky Rewrite";
    await fs.writeTextAtomic(`${LIBRARY_ROOT}/docs/cached/meta.json`, JSON.stringify(meta));
    await useLibraryUi.getState().refresh();
    expect(useLibraryUi.getState().rows[0].author).toBe("Old Author");

    // Bump the manifest key: the rewrite becomes visible.
    const manifest = JSON.parse(await fs.readText(`${LIBRARY_ROOT}/manifest.json`));
    manifest.docs[0].updatedAt = "2026-02-01T00:00:00Z";
    await fs.writeTextAtomic(`${LIBRARY_ROOT}/manifest.json`, JSON.stringify(manifest));
    await useLibraryUi.getState().refresh();
    expect(useLibraryUi.getState().rows[0].author).toBe("Sneaky Rewrite");
  });

  it("refreshDocs patches only the given doc ids", async () => {
    await seedDoc("first", "First", "Author One", "2026-01-01T00:00:00Z");
    await seedDoc("second", "Second", "Author Two", "2026-01-02T00:00:00Z");
    await useLibraryUi.getState().refresh();
    expect(useLibraryUi.getState().rows.map((r) => r.title)).toEqual(["First", "Second"]);

    // Edit only "first"'s meta and bump its manifest key (manifest title too —
    // real edit flows keep both in sync through LibraryManager mutators).
    const meta = JSON.parse(await fs.readText(`${LIBRARY_ROOT}/docs/first/meta.json`));
    meta.title = "First (edited)";
    await fs.writeTextAtomic(`${LIBRARY_ROOT}/docs/first/meta.json`, JSON.stringify(meta));
    const manifest = JSON.parse(await fs.readText(`${LIBRARY_ROOT}/manifest.json`));
    for (const d of manifest.docs) {
      if (d.slug === "first") {
        d.title = "First (edited)";
        d.updatedAt = "2026-03-01T00:00:00Z";
      }
    }
    await fs.writeTextAtomic(`${LIBRARY_ROOT}/manifest.json`, JSON.stringify(manifest));

    await useLibraryUi.getState().refreshDocs(["doc-first"]);
    const rows = useLibraryUi.getState().rows;
    expect(rows.map((r) => r.title)).toEqual(["First (edited)", "Second"]);
  });

  it("carries import time and recent-activity keys on rows", async () => {
    await seedDoc("stamped", "Stamped", null, "2026-04-01T00:00:00Z");
    await useLibraryUi.getState().refresh();
    const r = useLibraryUi.getState().rows[0];
    expect(r.importedAt).toBe("2026-04-01T00:00:00Z");
    expect(r.activityAt).toBe("2026-04-01T00:00:00Z");
  });
});
