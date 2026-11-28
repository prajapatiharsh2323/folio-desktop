// IMPORT-003: a failed Replace must not delete the previous edition before
// the new one is committed. Synthetic library only, no real user data.
import { describe, expect, it, beforeEach } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import { LibraryManager } from "../src/store/libraryManager";
import { importFile, replaceDoc } from "../src/import/importService";

const ROOT = "/lib";
const TE = new TextEncoder();

/** Fails the first write after `arm()` — simulates disk full mid-commit. */
class FailingFs extends MemoryFileStore {
  private shouldFail: (path: string) => boolean = () => false;
  arm(predicate: (path: string) => boolean = () => true): void {
    this.shouldFail = predicate;
  }
  override async writeBytesAtomic(path: string, data: Uint8Array): Promise<void> {
    if (this.shouldFail(path)) {
      this.shouldFail = () => false;
      throw new Error("disk full");
    }
    await super.writeBytesAtomic(path, data);
  }
}

let fs: FailingFs;
let lm: LibraryManager;

beforeEach(() => {
  fs = new FailingFs();
  lm = new LibraryManager(fs, ROOT);
});

describe("replaceDoc failure safety (IMPORT-003)", () => {
  it("keeps the original edition readable when a write fails mid-replace", async () => {
    const originalText = "An original title\n\nOriginal searchable content here.";
    const seeded = await importFile(lm, "original.txt", TE.encode(originalText));
    expect(seeded.status).toBe("imported");
    const docId = seeded.docId!;
    const slug = (await lm.load())!.docs[0].slug;
    const originalPath = `${ROOT}/docs/${slug}/original/book.txt`;
    expect(await fs.readText(originalPath)).toBe(originalText);

    fs.arm();
    const result = await replaceDoc(
      lm,
      docId,
      "replacement.txt",
      TE.encode("A replacement\n\nDifferent content entirely."),
    );
    expect(result.status).toBe("refused");

    // The previous edition and every path in the still-current manifest
    // must remain readable — no broken shelf row, no lost original.
    expect(await fs.readText(originalPath)).toBe(originalText);
    const manifest = await lm.load();
    expect(manifest!.docs.some((d) => d.id === docId)).toBe(true);
    for (const file of manifest!.docs.find((d) => d.id === docId)!.files) {
      const path = `${ROOT}/${file.path}`; // manifest paths are library-relative
      expect(await fs.exists(path), `missing manifest path: ${path}`).toBe(true);
    }
  });

  it("never reports 'refused' after a doc is committed when the index write fails (IMPORT-002)", async () => {
    fs.arm((path) => path.includes("/index/text/"));
    const result = await importFile(lm, "indexed.txt", TE.encode("A title\n\nIndexed body words."));
    expect(result.status).toBe("refused");
    // A refused import must leave the library unchanged.
    expect((await lm.load())?.docs ?? []).toHaveLength(0);
  });
});
