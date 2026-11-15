// R6: the clipboard citation line for a shared selection — the quoted text
// plus the book's title and (when present) its author.
export function citationFor(quote: string, title: string, author: string | null): string {
  const trimmed = quote.trim();
  const by = author ? `, ${author}` : "";
  return `\u201C${trimmed}\u201D — ${title}${by}`;
}
