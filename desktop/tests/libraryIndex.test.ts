// Library index builder: worker path + synchronous fallback (R3).
// jsdom has no Worker support, so these tests exercise the fallback; the
// round-trip serialization that the worker depends on is covered in
// miniSearch.test.ts.
import { describe, it, expect } from "vitest";
import { buildLibraryIndex } from "../src/search/libraryIndex";
import { MiniSearch } from "../src/search/miniSearch";

describe("buildLibraryIndex", () => {
  it("builds a searchable index with the synchronous fallback", async () => {
    const built = await buildLibraryIndex([
      { id: "a", title: "Doc A", text: "alpha beta gamma" },
      { id: "b", title: "Doc B", text: "alpha delta" },
    ]);
    expect(built.docCount).toBe(2);
    expect(built.index.search("alpha beta", 5).map((h) => h.id)).toEqual(["a"]);
    expect(built.index.search("delta", 5).map((h) => h.id)).toEqual(["b"]);
  });

  it("returns an empty index for no docs", async () => {
    const built = await buildLibraryIndex([]);
    expect(built.docCount).toBe(0);
    expect(built.index.search("anything")).toEqual([]);
  });

  it("never returns the same instance twice (signature cache relies on fresh snapshots)", async () => {
    const a = await buildLibraryIndex([{ id: "a", title: "T", text: "x" }]);
    const b = await buildLibraryIndex([{ id: "a", title: "T", text: "x" }]);
    expect(a.index).not.toBe(b.index);
    expect(a.index).toBeInstanceOf(MiniSearch);
  });
});
