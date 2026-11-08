import { describe, expect, it } from "vitest";
import { visibleRowIds } from "../src/lib/libraryView";

describe("visible row selection", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("selects every row when no collection filter is active", () => {
    expect([...visibleRowIds(rows, null)]).toEqual(["a", "b", "c"]);
  });

  it("never selects rows hidden by a collection filter", () => {
    expect([...visibleRowIds(rows, new Set(["a", "c"]))]).toEqual(["a", "c"]);
  });

  it("returns an empty selection when the filter matches nothing", () => {
    expect(visibleRowIds(rows, new Set()).size).toBe(0);
  });
});
