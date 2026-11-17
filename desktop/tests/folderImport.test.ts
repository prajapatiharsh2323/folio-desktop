// F7 (Phase 5): folder-import scan — recursive walk over a granted root.
// MemoryFileStore stands in for the guard-checked `fs_list_dir`/`fs_stat`
// commands the real path uses.
import { describe, expect, it, vi } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import {
  FolderScanError,
  MAX_FOLDER_FILES,
  MAX_WALK_DEPTH,
  scanFolderForImport,
} from "../src/lib/folderImport";

async function seed(fs: MemoryFileStore): Promise<void> {
  const w = (p: string, data = "x") => fs.writeBytesAtomic(p, new TextEncoder().encode(data));
  await w("/picked/novel.epub", "EPUB");
  await w("/picked/article.html");
  await w("/picked/notes.txt");
  await w("/picked/readme.md");
  await w("/picked/sub/deep/nested.epub");
  // unsupported types are ignored silently (the OS folder can hold anything)
  await w("/picked/image.png");
  await w("/picked/sub/noext");
  // noise folders are skipped wholesale
  await w("/picked/.hidden/secret.epub");
  await w("/picked/node_modules/pkg/index.epub");
}

describe("scanFolderForImport", () => {
  it("walks recursively, filters extensions, and skips hidden/noise dirs", async () => {
    const fs = new MemoryFileStore();
    await seed(fs);
    const result = await scanFolderForImport(fs, "/picked");
    const names = result.files.map((f) => f.name).sort();
    expect(names).toEqual(["article.html", "nested.epub", "notes.txt", "novel.epub", "readme.md"]);
    expect(result.truncated).toBe(false);
    expect(result.skippedCount).toBe(2); // .hidden + node_modules
  });

  it("exposes sizes via fs_stat and reads lazily through the store", async () => {
    const fs = new MemoryFileStore();
    await seed(fs);
    const statSpy = vi.spyOn(fs, "stat");
    const result = await scanFolderForImport(fs, "/picked");
    const epub = result.files.find((f) => f.name === "novel.epub")!;
    expect(epub.size).toBe(4);
    expect(statSpy).toHaveBeenCalled(); // sizes came from stat, not reads
    const statCalls = statSpy.mock.calls.length;
    const bytes = await epub.read();
    expect(new TextDecoder().decode(bytes)).toBe("EPUB");
    expect(statSpy.mock.calls.length).toBe(statCalls); // the read doesn't stat
  });

  it("truncates at the file cap and reports it", async () => {
    const fs = new MemoryFileStore();
    for (let i = 0; i < MAX_FOLDER_FILES + 5; i++) {
      await fs.writeBytesAtomic(`/big/b${i}.epub`, new Uint8Array([1]));
    }
    const result = await scanFolderForImport(fs, "/big");
    expect(result.files).toHaveLength(MAX_FOLDER_FILES);
    expect(result.truncated).toBe(true);
  });

  it("stops at the depth cap instead of descending forever", async () => {
    const fs = new MemoryFileStore();
    // chain of MAX_WALK_DEPTH + 2 nested dirs, book only at the bottom
    let p = "/deep";
    for (let i = 0; i < MAX_WALK_DEPTH + 2; i++) p += `/d${i}`;
    await fs.writeBytesAtomic(`${p}/buried.epub`, new Uint8Array([1]));
    await expect(scanFolderForImport(fs, "/deep")).rejects.toThrow(FolderScanError);
  });

  it("throws FolderScanError with plain copy when nothing is importable", async () => {
    const fs = new MemoryFileStore();
    await fs.writeBytesAtomic("/empty/only.png", new Uint8Array([1]));
    await expect(scanFolderForImport(fs, "/empty")).rejects.toThrow(
      "No importable books or articles were found",
    );
  });

  it("survives a directory listing failure and keeps walking", async () => {
    const fs = new MemoryFileStore();
    await seed(fs);
    const list = fs.list.bind(fs);
    vi.spyOn(fs, "list").mockImplementation(async (dir: string) => {
      if (dir.endsWith("/sub")) throw new Error("unreadable");
      return list(dir);
    });
    const result = await scanFolderForImport(fs, "/picked");
    // /sub itself counts as skipped; its nested.epub is unreachable
    expect(result.skippedCount).toBe(3);
    expect(result.files.map((f) => f.name)).not.toContain("nested.epub");
    expect(result.files.length).toBeGreaterThan(0);
  });

  it("accepts a custom maxFiles limit", async () => {
    const fs = new MemoryFileStore();
    for (let i = 0; i < 5; i++) {
      await fs.writeBytesAtomic(`/small/b${i}.epub`, new Uint8Array([1]));
    }
    const result = await scanFolderForImport(fs, "/small", { maxFiles: 3 });
    expect(result.files).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
});
