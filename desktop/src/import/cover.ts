// Default cover fallback: 8-tint family by stable colorSeed derived from the doc
// id (CoverFallback.kt behavior). Rendering itself lives in the UI (FolioBookRow).
export const TINT_COUNT = 8;

/** Deterministic per-book seed for cover tint selection. */
export function tintIndexFromHash(hash: string): number {
  return parseInt(hash.slice(0, 2), 16) % TINT_COUNT;
}
