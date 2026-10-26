import { describe, expect, it } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import { LibraryManager } from "../src/store/libraryManager";
import { newUuid, nowIso } from "../src/model/ids";
import type { Annotation, DocMeta, Progress } from "../src/model/types";
import {
  mergeArraysById,
  mergeRecordByKey,
  mergeUserJsonFile,
} from "../src/sync/merge";
import { listLocalFiles, remapDocIds, runSync } from "../src/sync/engine";
import { readSyncState } from "../src/sync/state";
import type { DriveClient, RemoteFile } from "../src/sync/driveClient";

const ROOT = "/lib";
const APP = "/app";

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
    files: { original: "original/book.epub" },
    chapters: [],
    ...overrides,
  };
}

async function addDoc(lm: LibraryManager, overrides: Partial<DocMeta> = {}) {
  const meta = makeMeta(overrides);
  await lm.addDoc({
    meta,
    files: { "original/book.epub": new TextEncoder().encode("fake epub") },
  });
  return meta;
}

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decode(value: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(value));
}

describe("user file merge (05 §6.3)", () => {
  it("keeps the newest annotation and preserves unknown keys", () => {
    const local = [
      {
        id: "a",
        docId: "d1",
        updatedAt: "2024-01-01T00:00:00Z",
        note: "old",
        color: "yellow",
      },
    ];
    const remote = [
      {
        id: "a",
        docId: "d1",
        updatedAt: "2024-02-01T00:00:00Z",
        note: "new",
        color: "green",
        futureField: { nested: true },
      },
    ];
    expect(mergeArraysById(local, remote)).toEqual([
      {
        id: "a",
        docId: "d1",
        updatedAt: "2024-02-01T00:00:00Z",
        note: "new",
        color: "green",
        futureField: { nested: true },
      },
    ]);
  });

  it("unions collection members even when the newer record wins", () => {
    const local = [
      { id: "c", name: "C", docIds: ["d1"], updatedAt: "2024-01-01T00:00:00Z" },
    ];
    const remote = [
      { id: "c", name: "C", docIds: ["d2"], updatedAt: "2024-02-01T00:00:00Z" },
    ];
    const merged = mergeArraysById(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].docIds).toEqual(["d1", "d2"]);
  });

  it("merges progress records by updatedAt", () => {
    const local = {
      d1: { docId: "d1", percent: 20, updatedAt: "2024-01-01T00:00:00Z" },
      d2: { docId: "d2", percent: 50, updatedAt: "2024-01-01T00:00:00Z" },
    };
    const remote = {
      d1: { docId: "d1", percent: 70, updatedAt: "2024-03-01T00:00:00Z" },
      d3: { docId: "d3", percent: 10, updatedAt: "2024-03-01T00:00:00Z" },
    };
    const merged = mergeRecordByKey(local, remote) as unknown as typeof local & {
      d3: { percent: number };
    };
    expect(merged.d1.percent).toBe(70);
    expect(merged.d2.percent).toBe(50);
    expect(merged.d3.percent).toBe(10);
  });

  it("produces merged bytes for a known user file and local bytes otherwise", () => {
    const local = bytes([
      { id: "a", docId: "d", updatedAt: "2024-01-01T00:00:00Z", note: "old" },
    ]);
    const remote = bytes([
      { id: "a", docId: "d", updatedAt: "2024-02-01T00:00:00Z", note: "new" },
    ]);
    expect(decode(mergeUserJsonFile("user/annotations.json", local, remote))).toEqual([
      { id: "a", docId: "d", updatedAt: "2024-02-01T00:00:00Z", note: "new" },
    ]);

    const settings = new TextEncoder().encode('{"theme":"warm"}');
    const other = new TextEncoder().encode('{"theme":"dark"}');
    expect(mergeUserJsonFile("user/settings.json", settings, other)).toBe(settings);
  });
});

describe("docId remap (05 §6.5)", () => {
  it("re-keys progress and annotations to the first-imported docId", async () => {
    const fs = new MemoryFileStore();
    const lm = new LibraryManager(fs, ROOT);
    const first = await addDoc(lm, {
      contentHash: "h".repeat(64),
      importedAt: "2024-01-01T00:00:00Z",
      title: "First",
    });
    const second = await addDoc(lm, {
      contentHash: "h".repeat(64),
      importedAt: "2024-06-01T00:00:00Z",
      title: "Second",
    });

    const progress: Progress = {
      docId: second.id,
      location: "epubcfi(/6/2)",
      percent: 42,
      updatedAt: "2024-07-01T00:00:00Z",
    };
    await lm.progress.put(progress);
    const annotation: Annotation = {
      id: "ann-1",
      docId: second.id,
      quote: "hello",
      prefix: "",
      suffix: "",
      kind: "highlight",
      color: "yellow",
      createdAt: "2024-07-01T00:00:00Z",
      updatedAt: "2024-07-01T00:00:00Z",
    };
    await lm.annotations.add(annotation);

    const result = await remapDocIds(fs, ROOT);
    expect(result.remaps).toBe(1);
    expect(result.changedFiles).toEqual(
      expect.arrayContaining(["user/progress.json", "user/annotations.json"])
    );

    const afterProgress = await lm.progress.all();
    expect(afterProgress[first.id]?.percent).toBe(42);
    expect(afterProgress[second.id]).toBeUndefined();

    const afterAnnotations = await lm.annotations.list();
    expect(afterAnnotations).toHaveLength(1);
    expect(afterAnnotations[0].docId).toBe(first.id);
  });
});

describe("Drive mirror engine (05 §6)", () => {
  class FakeDrive {
    rootId = "root";
    tree = new Map<string, RemoteFile>();
    contents = new Map<string, Uint8Array>();
    uploads: string[] = [];
    folders: string[][] = [];

    async ensureRootFolder(): Promise<string> {
      return this.rootId;
    }

    async ensureFolderPath(_rootId: string, segments: string[]): Promise<string> {
      this.folders.push(segments);
      return `folder:${segments.join("/")}`;
    }

    async listTree(): Promise<Map<string, RemoteFile>> {
      return this.tree;
    }

    async download(fileId: string): Promise<Uint8Array> {
      const content = this.contents.get(fileId);
      if (!content) throw new Error(`missing fake content: ${fileId}`);
      return content;
    }

    async upload(
      name: string,
      _parentId: string,
      data: Uint8Array,
      existingId?: string
    ): Promise<RemoteFile> {
      this.uploads.push(name);
      const id = existingId ?? `upload-${this.uploads.length}`;
      this.contents.set(id, data);
      return {
        id,
        path: name,
        name,
        mimeType: "application/octet-stream",
        modifiedTime: new Date().toISOString(),
        isFolder: false,
      };
    }
  }

  function remoteFile(path: string, id: string, modifiedTime = nowIso()): RemoteFile {
    return {
      id,
      path,
      name: path.split("/").pop() ?? path,
      mimeType: "application/octet-stream",
      modifiedTime,
      isFolder: false,
    };
  }

  it("pulls remote-only files, pushes local files, and uploads manifest last", async () => {
    const fs = new MemoryFileStore();
    const lm = new LibraryManager(fs, ROOT);
    await addDoc(lm);
    await fs.writeTextAtomic(`${ROOT}/user/settings.json`, '{"theme":"light"}');

    const drive = new FakeDrive();
    drive.tree.set(
      "from-drive.txt",
      remoteFile("from-drive.txt", "drive-1", new Date(Date.now() + 60_000).toISOString())
    );
    drive.contents.set("drive-1", new TextEncoder().encode("remote text"));

    const result = await runSync(drive as unknown as DriveClient, {
      fs,
      root: ROOT,
      appDir: APP,
    });

    expect(await fs.readText(`${ROOT}/from-drive.txt`)).toBe("remote text");
    expect(result.pulled).toBe(1);
    expect(result.pushed).toBeGreaterThan(0);
    expect(drive.uploads[drive.uploads.length - 1]).toBe("manifest.json");
    // `index/` is never mirrored.
    expect(drive.uploads).not.toContain("index");

    const state = await readSyncState(fs, APP);
    expect(state.lastSyncAt).toBeTruthy();
    expect(state.files["manifest.json"]?.driveId).toBeTruthy();
    expect(state.files["from-drive.txt"]?.driveId).toBe("drive-1");
  });

  it("never deletes: a file missing locally is pulled, missing remotely is pushed", async () => {
    const fs = new MemoryFileStore();
    await fs.writeTextAtomic(`${ROOT}/keep.txt`, "local keep");

    const drive = new FakeDrive();
    drive.tree.set(
      "restored.txt",
      remoteFile("restored.txt", "drive-2", new Date(Date.now() + 60_000).toISOString())
    );
    drive.contents.set("drive-2", new TextEncoder().encode("restored"));

    await runSync(drive as unknown as DriveClient, { fs, root: ROOT, appDir: APP });

    expect(await fs.readText(`${ROOT}/keep.txt`)).toBe("local keep");
    expect(await fs.readText(`${ROOT}/restored.txt`)).toBe("restored");
    expect(drive.uploads).toContain("keep.txt");
  });

  it("merges user JSON instead of overwriting the newer side", async () => {
    const fs = new MemoryFileStore();
    const now = new Date().toISOString();
    const localAnnotation = {
      id: "a",
      docId: "d",
      quote: "local",
      prefix: "",
      suffix: "",
      kind: "highlight",
      createdAt: now,
      updatedAt: "2024-01-01T00:00:00Z",
    };
    await fs.writeTextAtomic(
      `${ROOT}/user/annotations.json`,
      JSON.stringify([localAnnotation])
    );

    const drive = new FakeDrive();
    drive.tree.set(
      "user/annotations.json",
      remoteFile("user/annotations.json", "ann-file", new Date(Date.now() + 60_000).toISOString())
    );
    drive.contents.set(
      "ann-file",
      bytes([
        { ...localAnnotation, quote: "remote", updatedAt: "2024-06-01T00:00:00Z" },
      ])
    );

    const result = await runSync(drive as unknown as DriveClient, {
      fs,
      root: ROOT,
      appDir: APP,
    });

    const merged = JSON.parse(await fs.readText(`${ROOT}/user/annotations.json`));
    expect(merged).toHaveLength(1);
    expect(merged[0].quote).toBe("remote");
    expect(result.merged + result.pushed).toBeGreaterThan(0);
    expect(drive.uploads).toContain("annotations.json");
  });

  it("lists local files with POSIX-relative paths and excludes index/", async () => {
    const fs = new MemoryFileStore();
    await fs.writeTextAtomic(`${ROOT}/manifest.json`, "{}");
    await fs.writeTextAtomic(`${ROOT}/docs/slug/meta.json`, "{}");
    await fs.writeTextAtomic(`${ROOT}/index/text/doc.json`, "{}");

    const files = await listLocalFiles(fs, ROOT);
    expect(Array.from(files.keys())).toEqual(["manifest.json", "docs/slug/meta.json"]);
  });
});
