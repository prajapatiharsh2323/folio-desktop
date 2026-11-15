// Additive position cache (Step 3.2): one JSON file per document that stores
// the synthesized positions list so reopening a book skips spine measurement.
// Purely additive — no schema-1 manifest/meta field is introduced — and every
// failure degrades to the pre-cache behaviour (regenerate, skip the write).
import { getLibraryFs, LIBRARY_ROOT } from "./libraryUi";
import { libraryLayout as L } from "../lib/libraryPaths";
import type { PositionsCacheHook } from "../reader/epubPublication";

const CACHE_SCHEMA = 1;

export function positionsCachePath(slug: string): string {
  return `${L.docDir(LIBRARY_ROOT, slug)}/cache/positions.json`;
}

export interface PositionsCacheDoc {
  slug: string;
  /** Manifest content hash; a replaced book invalidates its cache by hash. */
  contentHash: string;
}

/**
 * Build the load/save hooks for one document. `load` returns the serialized
 * position array (or null); `save` writes `{ schema, contentHash, positions }`
 * and never throws to the caller.
 */
export function positionsCacheFor(doc: PositionsCacheDoc): PositionsCacheHook {
  const path = positionsCachePath(doc.slug);
  const fs = getLibraryFs();
  const decoder = new TextDecoder();
  return {
    async load(): Promise<unknown | null> {
      try {
        const raw = await fs.readBytes(path);
        const parsed = JSON.parse(decoder.decode(raw)) as {
          schema?: number;
          contentHash?: string;
          positions?: unknown;
        };
        if (parsed.schema !== CACHE_SCHEMA) return null;
        if (doc.contentHash && parsed.contentHash !== doc.contentHash) return null;
        if (!Array.isArray(parsed.positions) || parsed.positions.length === 0) return null;
        return parsed.positions;
      } catch {
        return null; // missing/damaged cache → regenerate
      }
    },
    async save(positions): Promise<void> {
      try {
        const payload = {
          schema: CACHE_SCHEMA,
          contentHash: doc.contentHash,
          positions: positions.map((p) => p.serialize()),
        };
        await fs.writeBytesAtomic(path, new TextEncoder().encode(JSON.stringify(payload)));
      } catch {
        // A cache write is best-effort: the next open just regenerates.
      }
    },
  };
}
