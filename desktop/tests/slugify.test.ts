import { describe, it, expect } from "vitest";
import { resolveSlugConflict, slugify } from "../src/model/ids";

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("The Adventures of Tom Sawyer")).toBe("the-adventures-of-tom-sawyer");
  });

  it("strips punctuation runs", () => {
    expect(slugify("Hello, World! (v2)")).toBe("hello-world-v2");
  });

  it("collapses repeated separators", () => {
    expect(slugify("a  --  b")).toBe("a-b");
  });

  it("falls back to 'doc' when empty", () => {
    expect(slugify("   ——  ")).toBe("doc");
    expect(slugify("???")).toBe("doc");
  });

  it("resolves collisions with -2, -3 (mobile parity)", () => {
    const existing = new Set(["moby-dick"]);
    expect(resolveSlugConflict("moby-dick", existing)).toBe("moby-dick-2");
    expect(
      resolveSlugConflict("moby-dick", new Set(["moby-dick", "moby-dick-2"]))
    ).toBe("moby-dick-3");
    expect(resolveSlugConflict("fresh", existing)).toBe("fresh");
  });
});
