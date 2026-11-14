// Levenshtein distance with a banded early exit — used by both the index
// (fuzzy term matching) and the occurrence scanner (fuzzy word matching).

/** Maximum fuzzy distance for a query token length (mobile MiniSearch.kt). */
export function fuzzyMaxDist(len: number): number {
  return len >= 8 ? 2 : 1;
}

export function editDistance(a: string, b: string): number {
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
