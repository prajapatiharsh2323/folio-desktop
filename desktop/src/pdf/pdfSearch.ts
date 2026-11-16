// In-book search over PDF page texts (PDF plan §7.6). Pure: the engine feeds
// per-page text (cached by the session) and gets schema-compatible SearchHit
// rows — chapter title from the outline/page label, a structured snippet
// (L9: the panel renders `<mark>` React nodes, no innerHTML), and the shared
// "page-N" locator.
import type { SnippetPart, SnippetParts } from "../search/occurrences";

export interface PdfSearchPage {
  /** 1-based page */
  page: number;
  /** page text (whitespace-joined items) */
  text: string;
  /** outline section title or page label; falls back to "Page N" */
  title?: string | null;
}

export interface PdfSearchHit {
  page: number;
  chapterTitle: string;
  snippet: SnippetParts;
  locator: string;
}

const SNIPPET_CONTEXT = 48;

function snippetFor(text: string, at: number, needleLength: number): SnippetParts {
  const from = Math.max(0, at - SNIPPET_CONTEXT);
  const to = Math.min(text.length, at + needleLength + SNIPPET_CONTEXT);
  const parts: SnippetPart[] = [];
  if (from < at) parts.push({ text: text.slice(from, at), mark: false });
  parts.push({ text: text.slice(at, at + needleLength), mark: true });
  if (at + needleLength < to) {
    parts.push({ text: text.slice(at + needleLength, to), mark: false });
  }
  return { parts, head: from > 0, tail: to < text.length };
}

/** Case-insensitive substring search over every page's text. One hit per
 *  occurrence, in document order, capped so a pathological query cannot
 *  flood the panel. */
export function findPdfSearchHits(
  pages: PdfSearchPage[],
  query: string,
  max = 200,
): PdfSearchHit[] {
  const needle = query.replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return [];
  const hits: PdfSearchHit[] = [];
  for (const page of pages) {
    if (hits.length >= max) break;
    const haystack = page.text.replace(/\s+/g, " ").toLowerCase();
    let at = haystack.indexOf(needle);
    while (at >= 0 && hits.length < max) {
      hits.push({
        page: page.page,
        chapterTitle: page.title?.trim() ? page.title : `Page ${page.page}`,
        snippet: snippetFor(page.text.replace(/\s+/g, " "), at, needle.length),
        locator: `page-${page.page}`,
      });
      at = haystack.indexOf(needle, at + needle.length);
    }
  }
  return hits;
}
