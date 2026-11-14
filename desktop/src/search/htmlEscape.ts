/** Escape book text before it is inserted into a snippet's <mark> markup.
 *  Shared by the index snippets and the per-occurrence search results. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
