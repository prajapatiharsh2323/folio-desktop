// Rebuild the derived search index after a backup is applied.
//
// `index/text/<docId>.json` is not part of backups: it is reproducible from the
// reading EPUB and would otherwise bloat the archive with stale text. Library
// search misses a document until its index exists, so restore regenerates it
// for every restored doc.

import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { readJsonAsync } from "../store/jsonio";
import { parseEpub } from "../import/epubImporter";
import type { DocMeta, Manifest } from "../model/types";

export interface ReindexFailure {
  docId: string;
  error: string;
}

export interface ReindexResult {
  indexed: number;
  failed: ReindexFailure[];
}

export async function reindexDocs(
  fs: FileStore,
  root: string,
  docIds: string[]
): Promise<ReindexResult> {
  const result: ReindexResult = { indexed: 0, failed: [] };
  const unique = [...new Set(docIds)];
  if (unique.length === 0) return result;

  const manifest = await readJsonAsync<Manifest>(fs, L.manifest(root));
  if (!manifest) return result;
  const byId = new Map(manifest.docs.map((d) => [d.id, d]));

  for (const docId of unique) {
    const doc = byId.get(docId);
    if (!doc) continue;
    try {
      const meta = await readJsonAsync<DocMeta>(fs, L.docMeta(root, doc.slug));
      if (!meta) throw new Error("metadata is missing");
      const reading = (meta.files.reading ?? "reading/book.epub").replace(/^\/+/, "");
      const bytes = await fs.readBytes(`${L.docDir(root, doc.slug)}/${reading}`);
      const parsed = parseEpub(bytes);
      const byChapterId = new Map(parsed.chapters.map((c) => [c.id, c.text]));

      // Prefer the document's stored chapter list (stable ids); fall back to
      // spine order when an older document has no chapters recorded.
      const chapters = meta.chapters.length
        ? meta.chapters.map((c, i) => ({
            id: c.id,
            title: c.title,
            order: c.order,
            text: byChapterId.get(c.id) ?? parsed.chapters[i]?.text ?? "",
          }))
        : parsed.chapters.map((c) => ({
            id: c.id,
            title: c.title,
            order: c.order,
            text: c.text,
          }));

      const index = { schema: 1 as const, chapters };
      await fs.writeBytesAtomic(
        L.indexText(root, docId),
        new TextEncoder().encode(JSON.stringify(index))
      );
      result.indexed++;
    } catch (e) {
      result.failed.push({
        docId,
        error: e instanceof Error ? e.message : "Index rebuild failed",
      });
    }
  }
  return result;
}
