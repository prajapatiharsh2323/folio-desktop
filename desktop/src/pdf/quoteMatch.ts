// Quote matching across text-layer spans (PDF plan §7.4). The pdf.js text
// layer renders one span per text item; a highlight's quote usually spans
// several of them. A DOM selection's `toString()` is the verbatim
// concatenation of the span texts (spans carry their own spaces; mid-word
// splits have none), so the haystack here is that exact concatenation with
// whitespace runs collapsed — and the match maps back to span-local raw
// offsets so the engine can build DOM ranges. Pure, no pdf.js, no geometry.

export interface QuoteMatch {
  /** span index containing the first matched character */
  startSpan: number;
  /** raw char offset of the first matched character in that span */
  startOffset: number;
  /** span index containing the last matched character */
  endSpan: number;
  /** raw char offset (inclusive) of the last matched character in that span */
  endOffset: number;
}

interface CompiledSpans {
  /** spans.join(""), with each whitespace run collapsed to one space */
  haystack: string;
  /** haystack index → raw index in the concatenated string */
  map: number[];
  /** raw offset where each span begins in the concatenated string */
  spanStarts: number[];
  /** concatenated (raw) length of each span */
  spanLengths: number[];
}

function compile(spans: string[]): CompiledSpans {
  const raw = spans.join("");
  const spanStarts: number[] = [];
  const spanLengths: number[] = [];
  let offset = 0;
  for (const span of spans) {
    spanStarts.push(offset);
    spanLengths.push(span.length);
    offset += span.length;
  }

  let pendingSpace = false;
  let started = false;
  const text: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      pendingSpace = started;
      continue;
    }
    if (pendingSpace) {
      text.push(" ");
      // The collapsed separator stands for the whole whitespace run; map it
      // to its first raw character so a match landing on it resolves.
      map.push(i === 0 ? -1 : indexOfRunStart(raw, i));
      pendingSpace = false;
    }
    started = true;
    text.push(ch.toLowerCase());
    map.push(i);
  }
  return { haystack: text.join(""), map, spanStarts, spanLengths };
}

/** The raw index where the whitespace run ending just before `i` began. */
function indexOfRunStart(raw: string, i: number): number {
  let j = i;
  while (j > 0 && /\s/.test(raw[j - 1])) j--;
  return j;
}

function locate(
  compiled: CompiledSpans,
  rawIndex: number,
): { span: number; offset: number } | null {
  if (rawIndex < 0) return null;
  for (let i = 0; i < compiled.spanStarts.length; i++) {
    const start = compiled.spanStarts[i];
    if (rawIndex >= start && rawIndex < start + compiled.spanLengths[i]) {
      return { span: i, offset: rawIndex - start };
    }
  }
  return null;
}

function findRawAt(compiled: CompiledSpans, haystackIndex: number): number {
  const raw = compiled.map[haystackIndex];
  return raw === undefined ? -1 : raw;
}

/** Find `quote` in the span texts. Returns null when the quote does not
 *  occur (e.g. a scanned page, or a mobile-written annotation quote whose
 *  text the page no longer contains). */
export function matchQuote(spans: string[], quote: string, from = 0): QuoteMatch | null {
  const needle = quote.replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return null;
  const compiled = compile(spans);
  const at = compiled.haystack.indexOf(needle, from);
  if (at < 0) return null;
  const startRaw = findRawAt(compiled, at);
  const endRaw = findRawAt(compiled, at + needle.length - 1);
  if (startRaw < 0 || endRaw < 0) return null;
  const start = locate(compiled, startRaw);
  const end = locate(compiled, endRaw);
  if (!start || !end) return null;
  return {
    startSpan: start.span,
    startOffset: start.offset,
    endSpan: end.span,
    endOffset: end.offset,
  };
}

/** All occurrences (up to `cap`), left to right. */
export function quoteOccurrences(spans: string[], quote: string, cap = 20): QuoteMatch[] {
  const out: QuoteMatch[] = [];
  let from = 0;
  while (out.length < cap) {
    const match = matchQuote(spans, quote, from);
    if (!match) break;
    out.push(match);
    from = advanceHaystack(spans, match);
    if (from <= 0) break;
  }
  return out;
}

/** Haystack offset just past a match — recomputed from the span offsets. */
function advanceHaystack(spans: string[], match: QuoteMatch): number {
  const compiled = compile(spans);
  const endSpanStart = compiled.spanStarts[match.endSpan] ?? 0;
  return compiled.map.indexOf(endSpanStart + match.endOffset) + 1;
}

/** Context stored with a highlight anchor. */
export interface QuoteContext {
  prefix?: string | null;
  suffix?: string | null;
}

/** Raw (whitespace-preserving) context window around one span match. */
function matchWindow(spans: string[], match: QuoteMatch, width = 32): QuoteContext {
  const raw = spans.join("");
  let startRaw = match.startOffset;
  for (let i = 0; i < match.startSpan; i++) startRaw += spans[i].length;
  let endRaw = match.endOffset;
  for (let i = 0; i < match.endSpan; i++) endRaw += spans[i].length;
  return {
    prefix: raw.slice(Math.max(0, startRaw - width), startRaw),
    suffix: raw.slice(endRaw + 1, endRaw + 1 + width),
  };
}

function norm(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** How well one occurrence's surrounding text agrees with the stored anchor. */
export function matchContextScore(
  spans: string[],
  match: QuoteMatch,
  context: QuoteContext,
): number {
  const window = matchWindow(spans, match);
  const storedPrefix = norm(context.prefix);
  const storedSuffix = norm(context.suffix);
  const prefix = norm(window.prefix);
  const suffix = norm(window.suffix);
  let score = 0;
  if (storedPrefix && prefix) {
    score += prefix.includes(storedPrefix) || storedPrefix.includes(prefix) ? 2 : -2;
  }
  if (storedSuffix && suffix) {
    score += suffix.includes(storedSuffix) || storedSuffix.includes(suffix) ? 2 : -2;
  }
  return score;
}

/**
 * Pick the occurrence whose surrounding text best matches a stored highlight
 * anchor. Without context the legacy behaviour (paint every occurrence) is
 * retained so older/mobile annotations are not silently dropped.
 */
export function bestQuoteOccurrence(
  spans: string[],
  quote: string,
  context: QuoteContext,
  cap = 20,
): QuoteMatch[] {
  const all = quoteOccurrences(spans, quote, cap);
  if (all.length < 2 || (!norm(context.prefix) && !norm(context.suffix))) return all;
  const ranked = all
    .map((match) => ({ match, score: matchContextScore(spans, match, context) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0].score > 0 ? [ranked[0].match] : all;
}

/**
 * ≤32-char context around a quote inside a page's joined text (plan §4:
 * prefix/suffix are textual anchors, authoritative with the quote).
 *
 * Whitespace is collapsed for matching, so the match index cannot be used to
 * slice the raw text directly — a page with double spaces or newlines shifts
 * every later offset. Build a normalised haystack together with a map back to
 * raw character indices, then slice the original string with those.
 */
export function extractContext(
  pageText: string,
  quote: string,
  width = 32,
): { prefix: string; suffix: string } {
  const needle = quote.replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return { prefix: "", suffix: "" };

  const chars: string[] = [];
  const rawIndex: number[] = [];
  let pendingSpace = false;
  let started = false;
  for (let i = 0; i < pageText.length; i++) {
    const ch = pageText[i];
    if (/\s/.test(ch)) {
      pendingSpace = started;
      continue;
    }
    if (pendingSpace) {
      chars.push(" ");
      rawIndex.push(i);
      pendingSpace = false;
    }
    started = true;
    chars.push(ch.toLowerCase());
    rawIndex.push(i);
  }

  const at = chars.join("").indexOf(needle);
  if (at < 0) {
    // Unknown quote (stale annotation): empty context is valid — the quote
    // remains the anchor.
    return { prefix: "", suffix: "" };
  }
  const startRaw = rawIndex[at];
  const endRaw = rawIndex[at + needle.length - 1];
  return {
    prefix: pageText.slice(Math.max(0, startRaw - width), startRaw).replace(/^\s+/, ""),
    suffix: pageText.slice(endRaw + 1, endRaw + 1 + width).replace(/\s+$/, ""),
  };
}
