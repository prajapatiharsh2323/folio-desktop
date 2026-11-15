// Zip safety caps for the fflate import/open path (Step 3.2). The Rust zip
// reader enforces the same limits (commands/zip.rs); here we enforce them
// *before* decompression using the central-directory sizes fflate's `filter`
// exposes, so a hostile archive can't allocate first and fail later.
import { unzipSync, type Unzipped } from "fflate";

/** Refuse archives with more entries than this (Rust parity: MAX_ENTRIES). */
export const MAX_ZIP_ENTRIES = 20_000;
/** Refuse archives whose declared uncompressed total exceeds this (4 GiB). */
export const MAX_TOTAL_UNCOMPRESSED = 4 * 1024 * 1024 * 1024;
/** Refuse a single entry whose declared uncompressed size exceeds this (2 GiB). */
export const MAX_ENTRY_UNCOMPRESSED = 2 * 1024 * 1024 * 1024;

/** Thrown when a zip exceeds the entry-count or uncompressed-size caps. */
export class ZipLimitError extends Error {
  constructor(public reason: "too-many-entries" | "entry-too-large" | "archive-too-large") {
    super(`zip exceeds safety limits (${reason})`);
    this.name = "ZipLimitError";
  }
}

/**
 * unzipSync with the safety caps enforced in the filter callback — fflate
 * consults the filter before decompressing each entry, so nothing is inflated
 * once a cap trips. `originalSize` comes from the central directory; a header
 * that lies under-sizes its entry still cannot exceed the total cap across
 * entries, and the Rust path re-checks bytes actually decompressed.
 */
export function unzipLimited(bytes: Uint8Array): Unzipped {
  let entries = 0;
  let total = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      entries += 1;
      total += file.originalSize;
      if (entries > MAX_ZIP_ENTRIES) throw new ZipLimitError("too-many-entries");
      if (file.originalSize > MAX_ENTRY_UNCOMPRESSED) throw new ZipLimitError("entry-too-large");
      if (total > MAX_TOTAL_UNCOMPRESSED) throw new ZipLimitError("archive-too-large");
      return true;
    },
  });
}

/** True when a single lazy entry may be inflated (per-entry cap only). */
export function entryWithinCap(originalSize: number): boolean {
  return originalSize <= MAX_ENTRY_UNCOMPRESSED;
}
