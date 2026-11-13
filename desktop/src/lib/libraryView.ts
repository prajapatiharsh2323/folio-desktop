/** Ids the user can actually see under the active collection filter. */
export function visibleRowIds(rows: { id: string }[], allowed: Set<string> | null): Set<string> {
  if (!allowed) return new Set(rows.map((r) => r.id));
  return new Set(rows.filter((r) => allowed.has(r.id)).map((r) => r.id));
}
