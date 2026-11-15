import type { LibraryRow } from "../store/libraryUi";

/** Ids the user can actually see under the active collection filter. */
export function visibleRowIds(rows: { id: string }[], allowed: Set<string> | null): Set<string> {
  if (!allowed) return new Set(rows.map((r) => r.id));
  return new Set(rows.filter((r) => allowed.has(r.id)).map((r) => r.id));
}

export type LibrarySort = "recent" | "dateadded" | "progress" | "title" | "author";

/** L3: case-insensitive, numeric-aware comparisons for every library sort. */
const LOCALE_OPTS = { numeric: true, sensitivity: "base" } as const;

function byTitle(a: LibraryRow, b: LibraryRow): number {
  return a.title.localeCompare(b.title, undefined, LOCALE_OPTS);
}

/**
 * Library shelf ordering (06 §1.2, Step 3.3). Every sort lives here — not in
 * the store — so incremental row patches keep a consistent order:
 *  - "recent" (default): later of last-read and imported-at, then title
 *  - "dateadded": import time desc, then title
 *  - "progress": furthest-along first, New last, then title
 *  - "title"/"author": alphabetical (authors without a name last)
 */
export function sortLibraryRows(rows: LibraryRow[], sort: string): LibraryRow[] {
  return rows.slice().sort((a, b) => {
    if (sort === "title") return byTitle(a, b);
    if (sort === "author") {
      // Authors last, then title: a book without an author must not jump
      // ahead of named authors just because "" sorts first.
      const aa = a.author?.trim() ?? "";
      const bb = b.author?.trim() ?? "";
      if (aa && !bb) return -1;
      if (!aa && bb) return 1;
      const byAuthor = aa.localeCompare(bb, undefined, LOCALE_OPTS);
      if (byAuthor !== 0) return byAuthor;
      return byTitle(a, b);
    }
    if (sort === "dateadded") {
      if (a.importedAt !== b.importedAt) return b.importedAt.localeCompare(a.importedAt);
      return byTitle(a, b);
    }
    if (sort === "progress") {
      const ap = a.percent ?? -1;
      const bp = b.percent ?? -1;
      if (ap !== bp) return bp - ap;
      return byTitle(a, b);
    }
    if (a.activityAt !== b.activityAt) return b.activityAt.localeCompare(a.activityAt);
    return byTitle(a, b);
  });
}
