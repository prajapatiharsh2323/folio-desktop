import { describe, expect, it } from "vitest";
import { searchSignature } from "../src/lib/searchCache";

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
});
