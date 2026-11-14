// Per-occurrence text scanning (R2): given a chapter's extracted text and a
// query, find every match span (phrase first, then all words), and build
// highlight snippets with exact offsets — the pieces the old `indexOf`
// snippet could not do for accent-folded, prefix, or fuzzy matches.
//
// Matching is done on an offset-preserving folded copy of the text (lowercase
// + latin accent fold, see foldWithMap) so spans can be sliced from the raw
// text for snippets and text-quote anchors.
import { normalizeQuery, foldWithMap } from "./normalise";
import { editDistance, fuzzyMaxDist } from "./editDistance";

// eslint-disable-next-line no-misleading-character-class -- Devanagari range is intentionally part of the token class; changing it would alter the search index
const TOKEN_SPLIT = /[^a-z0-9\u0900-\u097f]+/;
// eslint-disable-next-line no-misleading-character-class -- Devanagari range is intentionally part of the token class; changing it would alter the search index
const TOKEN_RUN = /[a-z0-9\u0900-\u097f]+/g;

/** Raw-text match span. */
export interface Occurrence {
  start: number;
  end: number;
}

/** One word of the corpus, with folded form and raw-text offsets. */
interface WordEntry {
  start: number;
  end: number;
  folded: string;
}

/** Precomputed per-chapter scan structure (kept alive for the book session). */
export interface TextCorpus {
  raw: string;
  words: WordEntry[];
}

export function tokenize(query: string): string[] {
  return normalizeQuery(query).split(TOKEN_SPLIT).filter(Boolean);
}

/** Build the word list once per chapter; queries then scan words, not text. */
export function buildCorpus(raw: string): TextCorpus {
  const folded = foldWithMap(raw);
  const words: WordEntry[] = [];
  TOKEN_RUN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RUN.exec(folded.text)) !== null) {
    words.push({
      start: folded.srcStart[m.index],
      end: folded.srcEnd[m.index + m[0].length - 1],
      folded: m[0],
    });
  }
  return { raw, words };
}

/** Does a corpus word match a normalized query token (exact/prefix/fuzzy)? */
export function wordMatches(word: string, token: string): boolean {
  if (word === token) return true;
  if (word.startsWith(token)) return true;
  if (token.length > 4 && word.length > 4) {
    const maxDist = fuzzyMaxDist(token.length);
    return editDistance(word, token) <= maxDist;
  }
  return false;
}

export interface FindOptions {
  /** never return more than this many occurrences (total) */
  limit?: number;
}

/**
 * Find all match spans. Strategy (R2): phrase first — a run of consecutive
 * words matching the query tokens in order; when the phrase does not occur
 * (or the query is a single word), every word matching any token.
 */
export function findOccurrences(
  corpus: TextCorpus,
  query: string,
  opts: FindOptions = {},
): Occurrence[] {
  const tokens = tokenize(query);
  if (tokens.length === 0 || corpus.words.length === 0) return [];
  const limit = Math.max(1, opts.limit ?? Number.POSITIVE_INFINITY);

  let spans: Occurrence[] = [];
  if (tokens.length > 1) {
    spans = phraseSpans(corpus, tokens);
  }
  if (spans.length === 0) {
    spans = tokenSpans(corpus, tokens);
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return spans.slice(0, limit);
}

/** Consecutive-word runs matching every token in order. */
function phraseSpans(corpus: TextCorpus, tokens: string[]): Occurrence[] {
  const spans: Occurrence[] = [];
  const words = corpus.words;
  for (let i = 0; i + tokens.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < tokens.length; k++) {
      if (!wordMatches(words[i + k].folded, tokens[k])) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const first = words[i];
      const last = words[i + tokens.length - 1];
      spans.push({ start: first.start, end: last.end });
      i += tokens.length - 1; // non-overlapping runs
    }
  }
  return spans;
}

/** Every word matching any token, sorted by position. */
function tokenSpans(corpus: TextCorpus, tokens: string[]): Occurrence[] {
  const spans: Occurrence[] = [];
  for (const word of corpus.words) {
    for (const token of tokens) {
      if (wordMatches(word.folded, token)) {
        spans.push({ start: word.start, end: word.end });
        break;
      }
    }
  }
  return spans;
}

export interface SnippetOptions {
  /** characters of context kept on each side of the first match */
  window?: number;
  /** plain prefix when no match exists */
  plainLength?: number;
}

/**
 * Snippet around the first occurrence with every matching span inside the
 * window wrapped in <mark>. Text is HTML-escaped by the caller's helper.
 */
export function buildSnippet(
  raw: string,
  spans: Occurrence[],
  escape: (value: string) => string,
  opts: SnippetOptions = {},
): string {
  const window = opts.window ?? 40;
  if (spans.length === 0) {
    const head = raw.slice(0, opts.plainLength ?? 120);
    return escape(head) + (head.length < raw.length ? "…" : "");
  }
  const first = spans[0];
  const start = Math.max(0, first.start - window);
  const end = Math.min(raw.length, first.end + window);
  let out = start > 0 ? "…" : "";
  let cursor = start;
  for (const span of spans) {
    if (span.end <= start || span.start >= end) continue;
    const s = Math.max(span.start, start);
    const e = Math.min(span.end, end);
    if (s < cursor) continue; // overlapping marks are not representable
    out += escape(raw.slice(cursor, s));
    out += `<mark>${escape(raw.slice(s, e))}</mark>`;
    cursor = e;
  }
  out += escape(raw.slice(cursor, end));
  if (end < raw.length) out += "…";
  return out;
}

/**
 * Text-quote anchor context for a match: the match text plus ±32 chars, in
 * the raw extracted text. The navigator matches this against the frame's
 * textContent (exact first, then approximate — whitespace-only deltas from
 * collapsing score near 1.0), so `goAnchored` lands on the match.
 */
export function anchorFor(
  raw: string,
  span: Occurrence,
): {
  quote: string;
  prefix: string;
  suffix: string;
} {
  return {
    quote: raw.slice(span.start, span.end),
    prefix: raw.slice(Math.max(0, span.start - 32), span.start),
    suffix: raw.slice(span.end, span.end + 32),
  };
}
