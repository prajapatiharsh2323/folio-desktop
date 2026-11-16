import { describe, it, expect } from "vitest";
import MiniSearch from "../src/search/miniSearch";
import { escapeHtml } from "../src/search/htmlEscape";

describe("miniSearch snippets", () => {
  it("carries raw text parts — the UI's React rendering provides the escaping", () => {
    const idx = new MiniSearch();
    idx.add({
      id: "ch1",
      title: "A Book",
      docTitle: "A Book",
      text: "Before <script>alert(1)</script> after",
      href: "chapter-1.xhtml#opening",
      chapterTitle: "Opening",
    });

    const [hit] = idx.search("script");
    const marked = hit.snippet.parts.filter((p) => p.mark);
    expect(marked.map((p) => p.text)).toEqual(["script"]);
    // The raw source text (with markup) rides along unescaped across the
    // parts; it is only ever rendered through React text nodes, which
    // escape it. The match splits the tag, so join the parts to check.
    expect(
      hit.snippet.parts
        .map((p) => p.text)
        .join("")
        .includes("<script>"),
    ).toBe(true);
    expect(hit.href).toBe("chapter-1.xhtml#opening");
    expect(hit.docTitle).toBe("A Book");
    expect(hit.chapterTitle).toBe("Opening");
  });

  it("falls back to a plain unmarked head when the query only matches the title", () => {
    const idx = new MiniSearch();
    idx.add({
      id: "ch1",
      title: "Danger",
      text: '<img src=x onerror="alert(1)">',
    });

    const [hit] = idx.search("danger");
    expect(hit.snippet.parts.every((p) => !p.mark)).toBe(true);
    expect(hit.snippet.parts.some((p) => p.text.includes("<img"))).toBe(true);
  });

  it("keeps the original casing of the matched term in the marked part", () => {
    const idx = new MiniSearch();
    idx.add({ id: "ch1", title: "Doc", text: "The Quick Brown Fox" });

    const [hit] = idx.search("quick");
    expect(hit.snippet.parts.filter((p) => p.mark).map((p) => p.text)).toEqual(["Quick"]);
  });

  it("escapeHtml handles all five markup characters", () => {
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});

describe("miniSearch R3 upgrades", () => {
  it("highlights accent-folded matches with raw offsets", () => {
    const idx = new MiniSearch();
    idx.add({ id: "ch1", title: "Doc", text: "He sat in the café near the window." });

    const [hit] = idx.search("cafe");
    expect(hit.snippet.parts.filter((p) => p.mark).map((p) => p.text)).toEqual(["café"]);
  });

  it("highlights prefix matches", () => {
    const idx = new MiniSearch();
    idx.add({ id: "ch1", title: "Doc", text: "The detective examined the evidence." });

    const [hit] = idx.search("detect");
    expect(hit.snippet.parts.filter((p) => p.mark).map((p) => p.text)).toEqual(["detective"]);
  });

  it("supports quoted phrases as a hard constraint", () => {
    const idx = new MiniSearch();
    idx.add({ id: "a", title: "Doc A", text: "the quick brown fox jumps" });
    idx.add({ id: "b", title: "Doc B", text: "brown quick the fox jumps" });

    const hits = idx.search('"quick brown"');
    expect(hits.map((h) => h.id)).toEqual(["a"]);
    const marked = hits[0].snippet.parts.filter((p) => p.mark).map((p) => p.text);
    expect(marked.join(" ")).toContain("quick brown");
  });

  it("keeps AND semantics for unquoted multi-word queries", () => {
    const idx = new MiniSearch();
    idx.add({ id: "a", title: "Doc A", text: "alpha beta gamma" });
    idx.add({ id: "b", title: "Doc B", text: "alpha delta" });

    const hits = idx.search("alpha gamma");
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });

  it("fuzzy-matches long words and still highlights the corpus word", () => {
    const idx = new MiniSearch();
    idx.add({ id: "ch1", title: "Doc", text: "The inspector examined everything." });

    const [hit] = idx.search("examine"); // distance 1 from "examined"
    expect(hit.snippet.parts.filter((p) => p.mark).map((p) => p.text)).toEqual(["examined"]);
  });
});

describe("serialize / fromPlain round-trip", () => {
  function sampleIndex() {
    const idx = new MiniSearch();
    idx.add({
      id: "a",
      title: "Sherlock Holmes",
      text: "The quick brown fox jumps over the lazy dog.",
    });
    idx.add({ id: "b", title: "Other Book", text: "A detective examines the study in scarlet." });
    return idx;
  }

  it("produces the same hits before and after a snapshot restore", () => {
    const original = sampleIndex();
    const restored = MiniSearch.fromPlain(original.serialize());

    for (const q of ["sherlock", "quick", "detective", "examine", '"study in scarlet"']) {
      expect(restored.search(q, 10)).toEqual(original.search(q, 10));
    }
  });

  it("keeps snippet building working after restore (corpus rebuilt lazily)", () => {
    const restored = MiniSearch.fromPlain(sampleIndex().serialize());
    const [hit] = restored.search("detective");
    expect(hit.snippet.parts.filter((p) => p.mark).map((p) => p.text)).toEqual(["detective"]);
  });

  it("keeps prefix and fuzzy matching after restore", () => {
    const restored = MiniSearch.fromPlain(sampleIndex().serialize());
    expect(restored.search("sherl", 5).map((h) => h.id)).toEqual(["a"]); // prefix
    expect(restored.search("detectiv", 5).map((h) => h.id)).toEqual(["b"]); // prefix
  });
});
