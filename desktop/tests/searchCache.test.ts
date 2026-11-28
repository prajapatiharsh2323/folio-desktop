import { describe, expect, it } from "vitest";
import {
  bumpSearchIndexGeneration,
  searchSignature,
  useSearchIndexGeneration,
} from "../src/lib/searchCache";

describe("search index signature", () => {
  it("is stable across row object identity", () => {
    const a = [{ id: "1", title: "One" }];
    const b = [{ id: "1", title: "One" }];
    expect(searchSignature(a)).toBe(searchSignature(b));
  });

  it("changes when a document is added, removed, or retitled", () => {
    const base = searchSignature([
      { id: "1", title: "One" },
      { id: "2", title: "Two" },
    ]);
    expect(searchSignature([{ id: "1", title: "One" }])).not.toBe(base);
    expect(
      searchSignature([
        { id: "1", title: "One" },
        { id: "2", title: "Two" },
        { id: "3", title: "Three" },
      ]),
    ).not.toBe(base);
    expect(
      searchSignature([
        { id: "1", title: "One" },
        { id: "2", title: "Deux" },
      ]),
    ).not.toBe(base);
  });

  it("changes when an index is rewritten without any row change (SEARCH-002)", () => {
    const rows = [{ id: "1", title: "One" }];
    const generationBefore = useSearchIndexGeneration.getState().generation;
    const before = searchSignature(rows);
    bumpSearchIndexGeneration();
    expect(useSearchIndexGeneration.getState().generation).toBe(generationBefore + 1);
    expect(searchSignature(rows)).not.toBe(before);
    expect(searchSignature(rows.map((r) => ({ ...r })))).toBe(searchSignature(rows));
  });
});
