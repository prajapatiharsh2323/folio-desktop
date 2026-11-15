// In-book search over PDF page texts (PDF plan §7.6). Pure: the engine feeds
// per-page text (cached by the session) and gets schema-compatible SearchHit
// rows — chapter title from the outline/page label, <mark> snippet, and the
// shared "page-N" locator.
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
  snippetHtml: string;
  locator: string;
}

/** Escape text before it is embedded in a snippet's <mark> markup. */
export function escapeSnippet(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SNIPPET_CONTEXT = 48;

function snippetFor(text: string, at: number, needleLength: number): string {
  const from = Math.max(0, at - SNIPPET_CONTEXT);
  const to = Math.min(text.length, at + needleLength + SNIPPET_CONTEXT);
  const lead = from > 0 ? "…" : "";
  const tail = to < text.length ? "…" : "";
  return (
    lead +
    escapeSnippet(text.slice(from, at)) +
    `<mark>${escapeSnippet(text.slice(at, at + needleLength))}</mark>` +
    escapeSnippet(text.slice(at + needleLength, to)) +
    tail
  );
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
        snippetHtml: snippetFor(page.text.replace(/\s+/g, " "), at, needle.length),
        locator: `page-${page.page}`,
      });
      at = haystack.indexOf(needle, at + needle.length);
    }
  }
  return hits;
}
