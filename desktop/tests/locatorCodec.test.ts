import { describe, expect, it } from "vitest";
import {
  anchorOf,
  decodeLocation,
  encodeLocation,
  hrefOf,
  isCfiLocation,
  sameLocation,
  withAnchor,
} from "../src/reader/locatorCodec";

describe("locatorCodec", () => {
  it("round-trips a plain href", () => {
    expect(encodeLocation({ href: "ch1.xhtml" })).toBe("ch1.xhtml");
    expect(decodeLocation("ch1.xhtml")).toEqual({ href: "ch1.xhtml" });
  });

  it("keeps a fragment anchor", () => {
    const value = encodeLocation({ href: "ch1.xhtml", fragment: "note-1" });
    expect(value).toBe("ch1.xhtml#note-1");
    expect(decodeLocation(value)).toEqual({ href: "ch1.xhtml", fragment: "note-1" });
  });

  it("stores the in-resource progression", () => {
    const value = encodeLocation({ href: "ch2.xhtml", progression: 0.4286123 });
    expect(value).toBe("ch2.xhtml?p=0.428612");
    expect(decodeLocation(value)?.progression).toBe(0.428612);
  });

  it("omits a zero progression and clamps out-of-range values", () => {
    expect(encodeLocation({ href: "a.xhtml", progression: 0 })).toBe("a.xhtml");
    expect(decodeLocation("a.xhtml?p=1.7")?.progression).toBe(1);
    expect(decodeLocation("a.xhtml?p=-2")).toEqual({ href: "a.xhtml" });
  });

  it("round-trips a text anchor with punctuation and unicode", () => {
    const value = encodeLocation({
      href: "ch1.xhtml",
      progression: 0.5,
      anchor: { quote: "Call me “Ishmael” & co?", prefix: "pre—fix", suffix: "suf/fix#1" },
    });
    const decoded = decodeLocation(value);
    expect(decoded?.href).toBe("ch1.xhtml");
    expect(decoded?.progression).toBe(0.5);
    expect(decoded?.anchor).toEqual({
      quote: "Call me “Ishmael” & co?",
      prefix: "pre—fix",
      suffix: "suf/fix#1",
    });
  });

  it("keeps the fragment after the query", () => {
    const value = encodeLocation({
      href: "ch1.xhtml",
      fragment: "frag",
      progression: 0.25,
      anchor: { quote: "hello" },
    });
    expect(value.endsWith("#frag")).toBe(true);
    expect(decodeLocation(value)).toMatchObject({ fragment: "frag", progression: 0.25 });
  });

  it("rejects CFI, empty and non-string values so callers fall back", () => {
    expect(decodeLocation("epubcfi(/6/2!/4/2)")).toBeNull();
    expect(isCfiLocation(" epubcfi(/6/2)")).toBe(true);
    expect(decodeLocation("")).toBeNull();
    expect(decodeLocation("   ")).toBeNull();
    expect(decodeLocation(null)).toBeNull();
    expect(decodeLocation(undefined)).toBeNull();
    expect(decodeLocation(42 as unknown as string)).toBeNull();
    expect(encodeLocation({ href: "" })).toBe("");
  });

  it("treats an unrelated query string as part of the href", () => {
    expect(decodeLocation("ch1.xhtml?edition=2")).toEqual({
      href: "ch1.xhtml?edition=2",
    });
    expect(decodeLocation("ch1.xhtml?edition=2&p=0.75")).toEqual({
      href: "ch1.xhtml?edition=2",
      progression: 0.75,
    });
  });

  it("hrefOf ignores progression and anchor noise", () => {
    expect(hrefOf("ch1.xhtml?p=0.1&q=hi#frag")).toBe("ch1.xhtml");
    expect(hrefOf("epubcfi(/6/2)")).toBeNull();
  });

  it("withAnchor preserves href/progression and replaces the anchor", () => {
    const base = "ch3.xhtml?p=0.75#frag";
    const anchored = withAnchor(base, {
      quote: "the whale",
      prefix: "before",
      suffix: "after",
    });
    const decoded = decodeLocation(anchored)!;
    expect(decoded.href).toBe("ch3.xhtml");
    expect(decoded.fragment).toBe("frag");
    expect(decoded.progression).toBe(0.75);
    expect(anchorOf(anchored)?.quote).toBe("the whale");

    const cleared = withAnchor(anchored, null);
    expect(cleared).toBe(anchored);
  });

  it("withAnchor is a no-op for values it cannot decode", () => {
    expect(withAnchor("epubcfi(/6/2)", { quote: "x" })).toBe("epubcfi(/6/2)");
  });

  it("sameLocation ignores sub-epsilon progression drift", () => {
    expect(sameLocation("ch1.xhtml?p=0.25", "ch1.xhtml?p=0.25002")).toBe(true);
    expect(sameLocation("ch1.xhtml?p=0.25", "ch1.xhtml?p=0.30")).toBe(false);
    expect(sameLocation("ch1.xhtml?p=0.25", "ch2.xhtml?p=0.25")).toBe(false);
    expect(sameLocation("ch1.xhtml#a", "ch1.xhtml#b")).toBe(false);
    expect(sameLocation(null, "ch1.xhtml")).toBe(false);
    expect(sameLocation("epubcfi(/6/2)", "epubcfi(/6/2)")).toBe(false);
  });
});
