// L7: collection-name validation — trim, 80-char cap, case-insensitive
// duplicate check with a rename self-exclusion.
import { describe, expect, it } from "vitest";
import { collectionNameError } from "../src/screens/CollectionsScreen";
import type { Collection } from "../src/model/types";

const EXISTING: Collection[] = [
  { id: "c1", name: "Space opera", docIds: [], createdAt: "" },
  { id: "c2", name: "Short stories", docIds: [], createdAt: "" },
];

describe("collectionNameError (L7)", () => {
  it("accepts a fresh, in-cap name", () => {
    expect(collectionNameError("Dune lore", EXISTING)).toBeNull();
  });

  it("rejects empty and whitespace-only names", () => {
    expect(collectionNameError("", EXISTING)).toBe("Enter a collection name.");
    expect(collectionNameError("   ", EXISTING)).toBe("Enter a collection name.");
  });

  it("rejects names over 80 characters", () => {
    expect(collectionNameError("x".repeat(81), EXISTING)).toBe(
      "Names are limited to 80 characters.",
    );
    expect(collectionNameError("x".repeat(80), EXISTING)).toBeNull();
  });

  it("rejects case-insensitive duplicates but allows the same collection renaming to itself", () => {
    expect(collectionNameError("space OPERA", EXISTING)).toBe(
      "A collection with that name already exists.",
    );
    expect(collectionNameError("  space opera  ", EXISTING)).toBe(
      "A collection with that name already exists.",
    );
    // Renaming c1 keeps its own (possibly re-cased) name legal.
    expect(collectionNameError("SPACE OPERA", EXISTING, "c1")).toBeNull();
    // But the rename must not collide with another collection.
    expect(collectionNameError("short stories", EXISTING, "c1")).toBe(
      "A collection with that name already exists.",
    );
  });
});
