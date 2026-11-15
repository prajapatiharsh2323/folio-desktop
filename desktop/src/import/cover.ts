// Default cover fallback: 8-tint family by stable colorSeed derived from the doc
// id (CoverFallback.kt behavior). Rendering itself lives in the UI (FolioBookRow).
export const TINT_COUNT = 8;

/** Deterministic per-book seed for cover tint selection. */
export function tintIndexFromHash(hash: string): number {
  return parseInt(hash.slice(0, 2), 16) % TINT_COUNT;
}

/**
 * L3: downscale a cover to a small JPEG thumbnail (≤160px wide) for the
 * library shelf. Uses createImageBitmap + OffscreenCanvas when available;
 * any failure (unsupported environment, undecodable image) yields null and
 * the shelf falls back to the full cover — thumbnails are best-effort.
 */
export async function makeCoverThumbnail(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (
      typeof createImageBitmap === "undefined" ||
      typeof OffscreenCanvas === "undefined" ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      return null;
    }
    const blob = new Blob([bytes as BlobPart]);
    const bitmap = await createImageBitmap(blob);
    try {
      const maxWidth = 160;
      const scale = Math.min(1, maxWidth / bitmap.width);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
      return new Uint8Array(await out.arrayBuffer());
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
