import { describe, it, expect } from "vitest";
import {
  COVER_PRESETS,
  COVER_PRESET_ITEMS,
  hashSeed,
  getBookCoverPreset,
  getCollectionCoverPreset,
} from "../src/lib/coverPresets";

describe("coverPresets", () => {
  it("exposes all 5 cover presets", () => {
    expect(COVER_PRESETS).toHaveLength(5);
    expect(COVER_PRESET_ITEMS).toHaveLength(5);
    COVER_PRESETS.forEach((url) => {
      expect(typeof url).toBe("string");
      expect(url.length).toBeGreaterThan(0);
    });
  });

  it("produces deterministic hashes for seeds", () => {
    const h1 = hashSeed("test-seed-123");
    const h2 = hashSeed("test-seed-123");
    expect(h1).toBe(h2);
    expect(h1).toBeGreaterThanOrEqual(0);
  });

  it("returns deterministic book covers across repeated calls", () => {
    const coverA1 = getBookCoverPreset("doc-uuid-1");
    const coverA2 = getBookCoverPreset("doc-uuid-1");
    const coverB = getBookCoverPreset("doc-uuid-2");

    expect(coverA1).toBe(coverA2);
    expect(COVER_PRESETS).toContain(coverA1);
    expect(COVER_PRESETS).toContain(coverB);
  });

  it("handles empty or falsy seeds gracefully", () => {
    const emptyCover = getBookCoverPreset("");
    expect(emptyCover).toBe(COVER_PRESETS[0]);

    const emptyCollectionCover = getCollectionCoverPreset("");
    expect(emptyCollectionCover).toBe(COVER_PRESETS[0]);
  });

  it("returns deterministic collection covers", () => {
    const colA1 = getCollectionCoverPreset("collection-42");
    const colA2 = getCollectionCoverPreset("collection-42");
    expect(colA1).toBe(colA2);
    expect(COVER_PRESETS).toContain(colA1);
  });
});
