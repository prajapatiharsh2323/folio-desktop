import { describe, it, expect } from "vitest";
import {
  buildCorpus,
  findOccurrences,
  buildSnippetParts,
  anchorFor,
  wordMatches,
} from "../src/search/occurrences";

const text = "Sherlock Holmes sat in the café. Sherlock Holmes spoke again. Déjà vu struck.";

describe("findOccurrences (R2)", () => {
  it("finds every occurrence of a single word", () => {
    const c = buildCorpus(text);
    const occ = findOccurrences(c, "sherlock");
    expect(occ).toHaveLength(2);
    expect(text.slice(occ[0].start, occ[0].end)).toBe("Sherlock");
    expect(text.slice(occ[1].start, occ[1].end)).toBe("Sherlock");
  });

  it("matches accented words from a folded query", () => {
    const c = buildCorpus(text);
    const occ = findOccurrences(c, "cafe");
    expect(occ).toHaveLength(1);
    expect(text.slice(occ[0].start, occ[0].end)).toBe("café");
    // and the reverse direction: folded query for Déjà
    const deja = findOccurrences(c, "deja");
    expect(text.slice(deja[0].start, deja[0].end)).toBe("Déjà");
  });

  it("matches prefixes", () => {
    const c = buildCorpus(text);
    const occ = findOccurrences(c, "hol");
    expect(occ.length).toBeGreaterThanOrEqual(2);
    for (const o of occ) expect(text.slice(o.start, o.end)).toBe("Holmes");
  });

  it("matches fuzzy variants (edit distance 1 for >4 chars)", () => {
    const c = buildCorpus(text);
    const occ = findOccurrences(c, "Holms"); // missing 'e'
    expect(occ).toHaveLength(2);
  });

  it("prefers phrase runs for multi-word queries, then falls back to all words", () => {
    const c = buildCorpus(text);
    const phrase = findOccurrences(c, "Sherlock Holmes spoke");
    expect(phrase).toHaveLength(1);
    expect(text.slice(phrase[0].start, phrase[0].end)).toBe("Sherlock Holmes spoke");

    // no adjacency anywhere → per-token occurrences
    const none = findOccurrences(c, "café struck");
    const words = ["café", "struck"];
    expect(none).toHaveLength(2);
    for (const o of none) expect(words).toContain(text.slice(o.start, o.end));
  });

  it("honours the limit", () => {
    const c = buildCorpus(text);
    expect(findOccurrences(c, "the", { limit: 1 })).toHaveLength(1);
  });

  it("returns nothing for a sub-tokenless query", () => {
    const c = buildCorpus(text);
    expect(findOccurrences(c, "  ")).toEqual([]);
  });
});

describe("wordMatches", () => {
  it("exact, prefix, fuzzy", () => {
    expect(wordMatches("sherlock", "sherlock")).toBe(true);
    expect(wordMatches("sherlock", "sher")).toBe(true);
    expect(wordMatches("holmes", "holms")).toBe(true);
    // short words never fuzzy-match
    expect(wordMatches("sat", "say")).toBe(false);
  });
});

describe("buildSnippetParts", () => {
  it("marks all spans inside the window as parts", () => {
    const c = buildCorpus(text);
    const occ = findOccurrences(c, "sherlock");
    const snip = buildSnippetParts(text, occ);
    // both occurrences inside the ±40 window are marked
    expect(snip.parts.filter((p) => p.mark).length).toBe(2);
    expect(snip.tail).toBe(true);
    expect(snip.head).toBe(false);
    const tail = snip.parts.at(-1);
    expect(tail && tail.text.includes("Holmes")).toBe(true);
  });

  it("keeps the raw casing of the matched term and the ellipsis flags", () => {
    const raw = "Intro sentence. The middle has Déjà in it. Tail sentence here.";
    const c = buildCorpus(raw);
    const occ = findOccurrences(c, "deja");
    const snip = buildSnippetParts(raw, occ, { window: 10 });
    expect(snip.head).toBe(true);
    expect(snip.tail).toBe(true);
    const marked = snip.parts
      .filter((p) => p.mark)
      .map((p) => p.text)
      .join("");
    expect(marked).toBe("Déjà");
  });

  it("falls back to a plain head without matches", () => {
    expect(buildSnippetParts("Plain text here", []).parts).toEqual([
      { text: "Plain text here", mark: false },
    ]);
    expect(buildSnippetParts("A".repeat(200), []).tail).toBe(true);
  });
});

describe("anchorFor (text-quote anchor context)", () => {
  it("gives the match plus ±32 raw characters", () => {
    const c = buildCorpus(text);
    const occ = findOccurrences(c, "spoke")[0];
    const anchor = anchorFor(text, occ);
    expect(anchor.quote).toBe("spoke");
    expect(anchor.prefix).toBe("at in the café. Sherlock Holmes ");
    expect(anchor.suffix).toBe(" again. Déjà vu struck.");
  });
});
