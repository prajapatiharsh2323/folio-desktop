import cover1 from "../assets/covers/cover-1.png";
import cover2 from "../assets/covers/cover-2.jpg";
import cover3 from "../assets/covers/cover-3.jpg";
import cover4 from "../assets/covers/cover-4.jpg";
import cover5 from "../assets/covers/cover-5.jpg";

export const COVER_PRESETS = [cover1, cover2, cover3, cover4, cover5] as const;

export interface CoverPresetInfo {
  id: string;
  url: string;
  label: string;
}

export const COVER_PRESET_ITEMS: readonly CoverPresetInfo[] = [
  { id: "cover-1", url: cover1, label: "Cover 1" },
  { id: "cover-2", url: cover2, label: "Cover 2" },
  { id: "cover-3", url: cover3, label: "Cover 3" },
  { id: "cover-4", url: cover4, label: "Cover 4" },
  { id: "cover-5", url: cover5, label: "Cover 5" },
];

/**
 * Compute a stable numeric hash from an arbitrary string (docId, contentHash, collectionId).
 */
export function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Deterministically returns a preset cover image URL for a book.
 */
export function getBookCoverPreset(seed: string): string {
  if (!seed) return COVER_PRESETS[0];
  const idx = hashSeed(seed) % COVER_PRESETS.length;
  return COVER_PRESETS[idx];
}

/**
 * Deterministically returns a preset cover image URL for a collection.
 */
export function getCollectionCoverPreset(collectionId: string): string {
  if (!collectionId) return COVER_PRESETS[0];
  const idx = hashSeed(`collection::${collectionId}`) % COVER_PRESETS.length;
  return COVER_PRESETS[idx];
}

