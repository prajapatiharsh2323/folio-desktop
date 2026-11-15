// Library + in-book search index (port of mobile core/search/MiniSearch.kt
// semantics: k1=1.2, b=0.7, fuzzy 0.2 for latin terms >4 chars, prefix
// matching, AND, quoted phrase support).
//
// Internals upgraded for R3: precomputed term frequencies, cached document
// frequencies, a sorted vocabulary with binary-search prefix expansion, and
// occurrence-based snippets (exact offsets for accent/prefix/fuzzy matches)
// shared with the in-book search via ./occurrences.
import { normalizeQuery } from "./normalise";
import { editDistance, fuzzyMaxDist } from "./editDistance";
import {
  buildSnippetParts,
  findOccurrences,
  wordMatches,
  type SnippetParts,
  type TextCorpus,
} from "./occurrences";

/** Fallback for docs with no text corpus (kept out of the index when empty). */
function plainSnippet(text: string): SnippetParts {
  const head = text.slice(0, 120);
  return { parts: head ? [{ text: head, mark: false }] : [], head: false, tail: text.length > 120 };
}

export interface SearchDoc {
  id: string;
  title: string;
  text: string;
  /** optional grouping key (document id) */
  docId?: string;
  /** document title, when the chapter title is shown separately */
  docTitle?: string;
  /** chapter href (plus fragment) used to open the reader at this hit */
  href?: string;
  chapterTitle?: string;
}

export interface SearchHit {
  id: string;
  score: number;
  /** L9: structured snippet — UIs render `<mark>` React nodes for marked parts. */
  snippet: SnippetParts;
  docId?: string;
  docTitle?: string;
  href?: string;
  chapterTitle?: string;
}

const K1 = 1.2;
const B = 0.7;

/** Serialized index snapshot (structured-clone-safe) shared with the worker. */
export interface MiniSearchPlain {
  docs: Array<{ doc: SearchDoc; len: number; titleTokens: string[] }>;
  postings: Array<[string, Array<[number, number]>]>;
  /** Sorted vocabulary (maintained by `sortVocab()` before serialization). */
  vocab: string[];
  avgLen: number;
}

function tokenizeText(s: string): string[] {
  return (
    normalizeQuery(s)
      // eslint-disable-next-line no-misleading-character-class -- Devanagari range is intentionally split on combining marks; changing it would alter the search index
      .split(/[^a-z0-9\u0900-\u097f]+/i)
      .filter(Boolean)
  );
}

/** Binary search: first index with vocab[i] >= value. */
function lowerBound(vocab: string[], value: string): number {
  let lo = 0;
  let hi = vocab.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vocab[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface IndexedDoc {
  doc: SearchDoc;
  /** folded token count of title + text (BM25 length) */
  len: number;
  titleTokens: Set<string>;
  /** lazily built word-scan structure for snippets + phrase verification */
  corpus: TextCorpus | null;
}

export class MiniSearch {
  private docs: IndexedDoc[] = [];
  /** term → doc index → term frequency (precomputed at add()). */
  private postings = new Map<string, Map<number, number>>();
  /** sorted vocabulary for binary-search prefix expansion. */
  private vocab: string[] = [];
  private avgLen = 1;
  private vocabDirty = false;
  private dfCache = new Map<string, number>();

  constructor(_options?: unknown) {}

  /**
   * Serializable snapshot of the built index. Postings/df are precomputed in
   * `add()`, so a snapshot can be produced off the main thread and restored
   * without re-tokenizing anything.
   */
  serialize(): MiniSearchPlain {
    this.sortVocab();
    return {
      docs: this.docs.map((d) => ({
        doc: d.doc,
        len: d.len,
        titleTokens: Array.from(d.titleTokens),
      })),
      postings: Array.from(this.postings, ([term, posting]) => [
        term,
        Array.from(posting, ([idx, tf]) => [idx, tf] as [number, number]),
      ]),
      vocab: this.vocab,
      avgLen: this.avgLen,
    };
  }

  /** Restore an index produced by `serialize()` (e.g. from a worker). */
  static fromPlain(plain: MiniSearchPlain): MiniSearch {
    const index = new MiniSearch();
    index.docs = plain.docs.map((d) => ({
      doc: d.doc,
      len: d.len,
      titleTokens: new Set(d.titleTokens),
      corpus: null,
    }));
    for (const [term, entries] of plain.postings) {
      index.postings.set(term, new Map(entries));
    }
    index.vocab = plain.vocab;
    index.avgLen = plain.avgLen;
    // vocab was sorted before serialization; dfCache rebuilds lazily.
    index.vocabDirty = false;
    return index;
  }

  add(doc: SearchDoc): void {
    const idx = this.docs.length;
    const tokens = tokenizeText(`${doc.title} ${doc.text}`);
    const titleTokens = new Set(tokenizeText(doc.title));
    this.docs.push({ doc, len: Math.max(1, tokens.length), titleTokens, corpus: null });

    // tokens arrive in text order — count runs for tf without a second map
    let prev = "";
    let run = 0;
    const flush = () => {
      if (!prev) return;
      let posting = this.postings.get(prev);
      if (!posting) {
        posting = new Map();
        this.postings.set(prev, posting);
      }
      posting.set(idx, (posting.get(idx) ?? 0) + run);
    };
    for (const t of tokens) {
      if (t === prev) {
        run += 1;
      } else {
        flush();
        prev = t;
        run = 1;
      }
    }
    flush();
    this.vocabDirty = true;
    this.dfCache.clear();
  }

  addAll(docs: SearchDoc[]): void {
    for (const d of docs) this.add(d);
  }

  private sortVocab(): void {
    if (this.vocabDirty) {
      this.vocab = Array.from(this.postings.keys()).sort();
      this.avgLen = Math.max(1, this.docs.reduce((sum, d) => sum + d.len, 0) / this.docs.length);
      this.vocabDirty = false;
    }
  }

  /** All vocabulary terms matching a query token (exact/prefix/fuzzy). */
  private matchingTerms(qt: string): string[] {
    this.sortVocab();
    const out: string[] = [];
    // exact + prefix: contiguous run in the sorted vocabulary
    const from = lowerBound(this.vocab, qt);
    for (let i = from; i < this.vocab.length; i++) {
      const term = this.vocab[i];
      if (!term.startsWith(qt)) break;
      out.push(term);
    }
    // fuzzy: full scan with a length prefilter (only for long tokens)
    if (qt.length > 4) {
      const maxDist = fuzzyMaxDist(qt.length);
      for (const term of this.vocab) {
        if (Math.abs(term.length - qt.length) > maxDist) continue;
        if (term === qt || term.startsWith(qt)) continue;
        if (editDistance(term, qt) <= maxDist) out.push(term);
      }
    }
    return out;
  }

  private candidateIndices(queryTokens: string[]): Set<number> {
    const out = new Set<number>();
    if (queryTokens.length === 0) return out;
    // AND: intersect per token (with prefix/fuzzy expansion).
    let result: Set<number> | null = null;
    for (const qt of queryTokens) {
      const matches = new Set<number>();
      for (const term of this.matchingTerms(qt)) {
        const posting = this.postings.get(term)!;
        for (const i of posting.keys()) matches.add(i);
      }
      if (result === null) {
        result = matches;
      } else {
        const next = new Set<number>();
        for (const i of result) if (matches.has(i)) next.add(i);
        result = next;
      }
      if (result.size === 0) return result;
    }
    return result ?? out;
  }

  search(query: string, limit = 25): SearchHit[] {
    const plainTokens: string[] = [];
    const phraseTokens: string[][] = [];
    let rest = query;
    const phraseRe = /"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = phraseRe.exec(query)) !== null) {
      const toks = tokenizeText(m[1]);
      if (toks.length > 0) phraseTokens.push(toks);
      rest = rest.replace(m[0], " ");
    }
    plainTokens.push(...tokenizeText(rest));
    if (phraseTokens.length > 0) plainTokens.push(...phraseTokens.flat());

    let indices = this.candidateIndices(plainTokens);
    // Quoted phrases are a hard constraint: docs must contain the phrase.
    for (const ptoks of phraseTokens) {
      const next = new Set<number>();
      for (const i of indices) {
        if (this.docContainsPhrase(i, ptoks)) next.add(i);
      }
      indices = next;
      if (indices.size === 0) break;
    }

    const hits: SearchHit[] = [];
    for (const i of indices) {
      const entry = this.docs[i];
      const score = this.score(i, entry, plainTokens);
      const corpus = this.corpusFor(i);
      const spans = corpus ? findOccurrences(corpus, query, { limit: 1 }) : [];
      hits.push({
        id: entry.doc.id,
        score,
        snippet: corpus
          ? buildSnippetParts(corpus.raw, spans)
          : plainSnippet(entry.doc.text),
        docId: entry.doc.docId,
        docTitle: entry.doc.docTitle,
        href: entry.doc.href,
        chapterTitle: entry.doc.chapterTitle,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  private docContainsPhrase(docIndex: number, tokens: string[]): boolean {
    const corpus = this.corpusFor(docIndex);
    if (!corpus) return false;
    const words = corpus.words;
    for (let i = 0; i + tokens.length <= words.length; i++) {
      let ok = true;
      for (let k = 0; k < tokens.length; k++) {
        if (!wordMatches(words[i + k].folded, tokens[k])) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  private corpusFor(docIndex: number): TextCorpus | null {
    const entry = this.docs[docIndex];
    if (!entry) return null;
    if (!entry.corpus) entry.corpus = buildCorpus(entry.doc.text);
    return entry.corpus;
  }

  private score(docIndex: number, entry: IndexedDoc, qTokens: string[]): number {
    this.sortVocab();
    const len = entry.len;
    let tfSum = 0;
    for (const qt of qTokens) {
      let tf = 0;
      for (const term of this.matchingTerms(qt)) {
        tf += this.postings.get(term)!.get(docIndex) ?? 0;
      }
      const idf = Math.log(1 + this.docs.length / (1 + this.df(qt)));
      const denom = K1 * (1 - B + (B * len) / this.avgLen) + tf;
      tfSum += (idf * (tf * (K1 + 1))) / denom;
    }
    // title boost
    for (const qt of qTokens) {
      for (const t of entry.titleTokens) {
        if (wordMatches(t, qt)) {
          tfSum += 0.5;
          break;
        }
      }
    }
    return tfSum;
  }

  private df(qt: string): number {
    const cached = this.dfCache.get(qt);
    if (cached !== undefined) return cached;
    let n = 0;
    for (const term of this.matchingTerms(qt)) n += this.postings.get(term)!.size;
    const df = Math.max(1, n);
    this.dfCache.set(qt, df);
    return df;
  }
}

export default MiniSearch;
