import { describe, it, expect } from "vitest";
import {
  decodeLocation,
  encodeLocation,
  hrefOf,
} from "../src/reader/locatorCodec";

describe("locator navigation", () => {
  it("keeps a chapter href and fragment from a search result", () => {
    const loc = decodeLocation("chapter-2.xhtml#sec-3");
    expect(loc).toEqual({ href: "chapter-2.xhtml", fragment: "sec-3" });
    expect(hrefOf("chapter-2.xhtml#sec-3")).toBe("chapter-2.xhtml");
  });

  it("round-trips href, fragment, progression and anchor", () => {
    const encoded = encodeLocation({
      href: "chapter-2.xhtml",
      fragment: "sec-3",
      progression: 0.4286,
      anchor: { quote: "Call me Ishmael", prefix: "before ", suffix: " after" },
    });
    const decoded = decodeLocation(encoded);
    expect(decoded?.href).toBe("chapter-2.xhtml");
    expect(decoded?.fragment).toBe("sec-3");
    expect(decoded?.progression).toBeCloseTo(0.4286, 4);
    expect(decoded?.anchor?.quote).toBe("Call me Ishmael");
  });

  it("preserves a query string that belongs to the href", () => {
    expect(hrefOf("chapter.xhtml?v=2#part")).toBe("chapter.xhtml?v=2");
  });

  it("rejects CFI locators so callers can fall back to percent", () => {
    expect(decodeLocation("epubcfi(/6/4[chap01]!/4/2/1:0)")).toBeNull();
    expect(hrefOf("epubcfi(/6/4[chap01]!/4/2/1:0)")).toBeNull();
  });
});
