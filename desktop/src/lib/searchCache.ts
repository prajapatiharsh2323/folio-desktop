/**
 * Identity of the library-wide search corpus. Rebuilding reads every text
 * index, so the Library screen only rebuilds when this signature changes
 * (import, delete, retitle) instead of on every search open.
 */
export function searchSignature(rows: { id: string; title: string }[]): string {
  return rows.map((row) => `${row.id}\u0000${row.title}`).join("\u0001");
}
