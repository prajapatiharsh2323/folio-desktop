// Default cover fallback: 8-tint family by stable colorSeed derived from the doc
// id (CoverFallback.kt behavior). Rendering itself lives in the UI (FolioBookRow).
import { sha256Hex } from "../lib/sha256";

export const TINT_COUNT = 8;

export async function tintIndexFromId(docId: string): Promise<number> {
  const hex = await sha256Hex(new TextEncoder().encode(docId));
  return parseInt(hex.slice(0, 2), 16) % TINT_COUNT;
}

/** Deterministic per-book seed for cover tint selection. */
export function tintIndexFromHash(hash: string): number {
  return parseInt(hash.slice(0, 2), 16) % TINT_COUNT;
}
