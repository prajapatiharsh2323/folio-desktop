// Lightweight search index (port of mobile core/search/MiniSearch.kt semantics).
// Mobile uses the `minisearch` package (k1=1.2, b=0.7, fuzzy 0.2 for latin
// terms >4 chars, prefix matching, AND). We keep the same defaults here so a
// future swap to the npm package is mechanical.
import { normalizeQuery } from "./normalise";

export interface SearchDoc {
  id: string;
  title: string;
  text: string;
  /** optional grouping key (document id) */
  docId?: string;
  chapterTitle?: string;
}

export interface SearchHit {
  id: string;
  score: number;
  /** highlighted snippet with matched terms wrapped in <mark> */
  snippet: string;
  docId?: string;
  chapterTitle?: string;
}

const K1 = 1.2;
const B = 0.7;
const AVG_LEN = 200;

function tokenize(s: string): string[] {
  return normalizeQuery(s)
    .split(/[^a-z0-9\u0900-\u097f]+/i)
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur + 1, prev[j - 1] + cost);
      prev[j - 1] = cur;
      cur = v;
    }
    prev[b.length] = cur;
  }
  return prev[b.length];
}

export class MiniSearch {
  private docs: SearchDoc[] = [];
  private inverted = new Map<string, Set<number>>();

  constructor(_options?: unknown) {}

  add(doc: SearchDoc): void {
    const idx = this.docs.length;
    this.docs.push(doc);
    const terms = new Set(tokenize(`${doc.title} ${doc.text}`));
    for (const t of terms) {
      if (!this.inverted.has(t)) this.inverted.set(t, new Set());
      this.inverted.get(t)!.add(idx);
    }
  }

  addAll(docs: SearchDoc[]): void {
    for (const d of docs) this.add(d);
  }

  private candidateIndices(queryTokens: string[]): Set<number> {
    const out = new Set<number>();
    if (queryTokens.length === 0) return out;
    // AND: intersect per token (with prefix/fuzzy expansion).
    let first = true;
    let result: Set<number> | null = null;
    for (const qt of queryTokens) {
      const matches = new Set<number>();
      for (const [term, idxs] of this.inverted) {
        if (this.termMatches(term, qt)) {
          for (const i of idxs) matches.add(i);
        }
      }
      if (first) {
        result = matches;
        first = false;
      } else {
        const next = new Set<number>();
        for (const i of result!) if (matches.has(i)) next.add(i);
        result = next;
      }
    }
    return result ?? out;
  }

  private termMatches(term: string, query: string): boolean {
    if (term === query) return true;
    if (term.startsWith(query)) return true;
    if (query.length > 4 && term.length > 4) {
      // fuzzy 0.2 → edit distance <= 1 for short, <=2 for longer
      const maxDist = query.length >= 8 ? 2 : 1;
      if (editDistance(term, query) <= maxDist) return true;
    }
    return false;
  }

  search(query: string, limit = 25): SearchHit[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];
    const indices = this.candidateIndices(qTokens);
    const hits: SearchHit[] = [];
    for (const i of indices) {
      const doc = this.docs[i];
      const score = this.score(doc, qTokens);
      hits.push({
        id: doc.id,
        score,
        snippet: this.snippet(doc.text, qTokens),
        docId: doc.docId,
        chapterTitle: doc.chapterTitle,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  private score(doc: SearchDoc, qTokens: string[]): number {
    const textTokens = tokenize(`${doc.title} ${doc.text}`);
    const len = Math.max(1, textTokens.length);
    let tfSum = 0;
    for (const qt of qTokens) {
      let tf = 0;
      for (const t of textTokens) if (this.termMatches(t, qt)) tf += 1;
      const idf = Math.log(1 + this.docs.length / (1 + this.df(qt)));
      const denom = K1 * (1 - B + (B * len) / AVG_LEN) + tf;
      tfSum += (idf * (tf * (K1 + 1))) / denom;
    }
    // title boost
    const titleTokens = tokenize(doc.title);
    for (const qt of qTokens) {
      if (titleTokens.some((t) => this.termMatches(t, qt))) tfSum += 0.5;
    }
    return tfSum;
  }

  private df(qt: string): number {
    let n = 0;
    for (const [term, idxs] of this.inverted) {
      if (this.termMatches(term, qt)) n += idxs.size;
    }
    return Math.max(1, n);
  }

  private snippet(text: string, qTokens: string[]): string {
    const lower = text;
    // find first occurrence of any query token (case-insensitive, normalized-ish)
    let idx = -1;
    let matched = "";
    const low = lower.toLowerCase();
    for (const qt of qTokens) {
      const i = low.indexOf(qt);
      if (i !== -1 && (idx === -1 || i < idx)) {
        idx = i;
        matched = qt;
      }
    }
    if (idx === -1) return text.slice(0, 120);
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + matched.length + 40);
    const prefix = (start > 0 ? "…" : "") + text.slice(start, idx);
    const term = text.slice(idx, idx + matched.length);
    const suffix = text.slice(idx + matched.length, end) + (end < text.length ? "…" : "");
    return `${prefix}<mark>${term}</mark>${suffix}`;
  }
}

export default MiniSearch;
