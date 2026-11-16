// Import pipeline orchestration (02 §6): detect → dedup gate → build → write
// doc folder → meta.json → index/text/<docId>.json → manifest rewrite LAST
// (via LibraryManager.addDoc, which owns the commit point).
import {
  assertImportable,
  detectFormat,
  stem,
  ImportError,
  type SourceFormatDetect,
} from "./fileDetector";
import { sha256Hex } from "../lib/sha256";
import { parseEpub } from "./epubImporter";
import { importHtml, importTxt, type ArticleImport } from "./articleImporters";
import { buildEpub } from "./clip/epubBuilder";
import type { LibraryManager } from "../store/libraryManager";
import type { DocMeta, DocKind, SourceFormat } from "../model/types";
import { nowIso, newUuid } from "../model/ids";
import { libraryLayout as L } from "../lib/libraryPaths";
import { makeCoverThumbnail } from "./cover";
import { parsePdf, type PdfOutlineEntry } from "../pdf/parsePdf";

export type DuplicateResolution = "skip" | "keep" | "replace";

export interface ImportResult {
  status: "imported" | "skipped" | "replaced" | "refused";
  docId?: string;
  title?: string;
  error?: string;
  errorCode?: ImportError["code"];
}

function ext(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i === -1 ? "" : fileName.slice(i + 1).toLowerCase();
}

async function sha256HexOf(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

/** What a format pipeline produces before anything is written to disk.
 *  EPUB/HTML/TXT keep `readingPath: "reading/book.epub"`; a future PDF branch
 *  returns `readingPath: "reading/book.pdf"` and `originalBytes: null`. */
export interface PipelineResult {
  title: string;
  author: string | null;
  kind: DocKind;
  language: string;
  sourceFormat: SourceFormat;
  chapters: DocMeta["chapters"];
  /** relative doc-folder path the reader opens */
  readingPath: string;
  readingBytes: Uint8Array;
  originalName: string;
  originalBytes: Uint8Array | null;
  cleanHtml: string | null;
  imageFiles: Record<string, Uint8Array>;
  cover: { name: string; bytes: Uint8Array } | null;
  wordCount: number | null;
  /** decided at import (plan §6.2); meta.json is immutable afterwards */
  searchable: boolean;
  /** plain text per chapter, aligned with chapters */
  chapterTexts: string[];
}

async function runPipeline(
  fileName: string,
  bytes: Uint8Array,
  format: SourceFormatDetect,
  contentHash: string,
): Promise<PipelineResult> {
  const originalName =
    format === "epub" ? "book.epub" : format === "html" ? "page.html" : "book.txt";
  const readingPath = "reading/book.epub";
  const sourceFormat: SourceFormat = format;

  if (format === "epub") {
    const parsed = parseEpub(bytes);
    return {
      title: parsed.title || stem(fileName),
      author: parsed.author,
      kind: "book",
      language: parsed.language || "en",
      sourceFormat,
      chapters: parsed.chapters.map((c) => ({
        id: c.id,
        title: c.title,
        order: c.order,
        href: c.href,
      })),
      readingPath,
      readingBytes: bytes,
      originalName,
      originalBytes: bytes,
      cleanHtml: null,
      imageFiles: {},
      cover: parsed.cover
        ? {
            name: `cover.${parsed.cover.ext === "jpeg" ? "jpg" : parsed.cover.ext}`,
            bytes: parsed.cover.bytes,
          }
        : null,
      wordCount: null,
      searchable: true,
      chapterTexts: parsed.chapters.map((c) => c.text),
    };
  }

  if (format === "pdf") {
    return await runPdfPipeline(fileName, bytes, contentHash);
  }

  const article: ArticleImport =
    format === "html"
      ? await importHtml(new TextDecoder().decode(bytes), stem(fileName))
      : importTxt(new TextDecoder().decode(bytes), stem(fileName));

  const built = await buildEpub({
    title: article.title,
    author: article.author,
    language: article.language,
    contentHash,
    chapters: article.chapters,
    images: article.images.map((img) => `${img.name}.${img.ext}`),
  });

  const imageFiles: Record<string, Uint8Array> = {};
  for (const img of article.images) {
    imageFiles[`clean/images/${img.name}.${img.ext}`] = img.bytes;
  }

  return {
    title: article.title,
    author: article.author,
    kind: "article",
    language: article.language,
    sourceFormat,
    chapters: built.chapters,
    readingPath,
    readingBytes: built.bytes,
    originalName,
    originalBytes: bytes,
    cleanHtml: article.cleanHtml || null,
    imageFiles,
    cover: null,
    wordCount: article.wordCount || null,
    searchable: true,
    chapterTexts: article.chapters.map((c) =>
      c.html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ),
  };
}

/** PDF branch (plan §6.2/§6.3): one copy under reading/, no original copy
 *  (backup validation only requires files.reading — §5), metadata + cover +
 *  searchable decided at import. Chapters are the flattened outline, falling
 *  back to at most 40 synthetic "Pages a–b" groups (plan §5). */
async function runPdfPipeline(
  fileName: string,
  bytes: Uint8Array,
  contentHash: string,
  onProgress?: (fraction: number) => void,
): Promise<PipelineResult> {
  void contentHash;
  const parsed = await parsePdf(fileName, bytes, { onProgress });
  return {
    title: parsed.title || stem(fileName),
    author: parsed.author,
    // D3: fewer than 20 pages reads like an article; the Library still shows
    // the PDF badge (sourceFormat drives it, not kind).
    kind: parsed.pageCount < 20 ? "article" : "book",
    language: parsed.language,
    sourceFormat: "pdf",
    chapters: pdfChapters(parsed.outline, parsed.pageCount),
    readingPath: "reading/book.pdf",
    readingBytes: bytes,
    originalName: "book.pdf",
    originalBytes: null,
    cleanHtml: null,
    imageFiles: {},
    cover: parsed.cover,
    wordCount: parsed.estimatedWordCount,
    searchable: parsed.searchable,
    chapterTexts: [],
  };
}

/** Flattened outline as chapters; de-duplicated by page (already done in
 *  parsePdf). Without an outline, synthetic groups of ≤25 pages. */
function pdfChapters(outline: PdfOutlineEntry[], pageCount: number): DocMeta["chapters"] {
  if (outline.length > 0) {
    return outline.map((entry, i) => ({
      id: `p${entry.page}`,
      title: entry.title || `Page ${entry.page}`,
      order: i,
      href: `page-${entry.page}`,
    }));
  }
  const chapters: DocMeta["chapters"] = [];
  const groupSize = Math.max(1, Math.ceil(pageCount / 40));
  for (let start = 1; start <= pageCount; start += groupSize) {
    const end = Math.min(pageCount, start + groupSize - 1);
    chapters.push({
      id: `p${start}`,
      title: end === start ? `Page ${start}` : `Pages ${start}–${end}`,
      order: chapters.length,
      href: `page-${start}`,
    });
  }
  return chapters;
}

/** meta.files is built in exactly one place so importFile and replaceDoc can
 *  never drift (02 §6). PDF later returns original: null + reading/book.pdf. */
export function buildMetaFiles(p: PipelineResult): DocMeta["files"] {
  return {
    original: p.originalBytes ? `original/${p.originalName}` : null,
    clean: p.cleanHtml !== null ? "clean/index.html" : null,
    reading: p.readingPath,
    cover: p.cover ? p.cover.name : null,
  };
}

export function filesMapFor(p: PipelineResult): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  if (p.originalBytes) files[`original/${p.originalName}`] = p.originalBytes;
  files[p.readingPath] = p.readingBytes;
  if (p.cleanHtml !== null) files["clean/index.html"] = new TextEncoder().encode(p.cleanHtml);
  for (const [rel, bytes] of Object.entries(p.imageFiles)) files[rel] = bytes;
  if (p.cover) files[p.cover.name] = p.cover.bytes;
  return files;
}

/**
 * L3: write a small shelf thumbnail as an additive cache file. Best-effort:
 * the thumbnail is skipped entirely when the environment can't decode images
 * (and the shelf falls back to the full cover).
 */
async function writeCoverThumbnail(
  lm: LibraryManager,
  slug: string,
  coverBytes: Uint8Array,
): Promise<void> {
  try {
    const thumb = await makeCoverThumbnail(coverBytes);
    if (thumb) {
      await lm.writeFileAtomic(`${L.docDir(lm.root, slug)}/cache/cover-thumb.jpg`, thumb);
    }
  } catch {
    // Undecodable image or unsupported environment — the full cover remains
    // the fallback, so a missing thumbnail is never an error.
  }
}

async function writeIndex(
  lm: LibraryManager,
  docId: string,
  chapters: { id: string; title: string; order: number; href: string }[],
  textByChapter: Map<string, string> | null,
): Promise<void> {
  const index = {
    schema: 1 as const,
    chapters: chapters.map((c) => ({
      id: c.id,
      title: c.title,
      order: c.order,
      href: c.href,
      text: textByChapter?.get(c.id) ?? "",
    })),
  };
  await lm.writeFileAtomic(
    L.indexText(lm.root, docId),
    new TextEncoder().encode(JSON.stringify(index)),
  );
}

export async function importFile(
  lm: LibraryManager,
  fileName: string,
  bytes: Uint8Array,
  onDuplicate?: (existingTitle: string) => Promise<DuplicateResolution>,
): Promise<ImportResult> {
  try {
    const format = assertImportable(fileName, bytes);
    const contentHash = await sha256HexOf(bytes);

    // dedup gate BEFORE the pipeline (02 §6)
    const manifest = await lm.load();
    const existing = manifest?.docs.find((d) => d.contentHash === contentHash);
    if (existing) {
      const resolution = onDuplicate ? await onDuplicate(existing.title) : "skip";
      if (resolution === "skip") return { status: "skipped", docId: existing.id };
      if (resolution === "replace")
        return replaceDoc(lm, existing.id, fileName, bytes, format, contentHash);
    }

    const p = await runPipeline(fileName, bytes, format, contentHash);
    const meta: DocMeta = {
      schema: 1,
      id: newUuid(),
      slug: "",
      title: p.title,
      author: p.author,
      kind: p.kind,
      language: p.language,
      sourceFormat: p.sourceFormat,
      sourceUrl: null,
      sourceName: null,
      capturedAt: nowIso(),
      importedAt: nowIso(),
      contentHash,
      wordCount: p.wordCount,
      searchable: p.searchable,
      tags: [],
      collectionIds: [],
      files: buildMetaFiles(p),
      chapters: p.chapters,
    };
    await lm.addDoc({ meta, files: filesMapFor(p) });

    if (p.sourceFormat !== "pdf") {
      // PDFs get their index from the background job (plan §6.4); an empty
      // import-time index would make library search silently return nothing.
      const textByChapter = new Map(p.chapters.map((c, i) => [c.id, p.chapterTexts[i] ?? ""]));
      await writeIndex(lm, meta.id, p.chapters, textByChapter);
    }

    // L3: additive shelf thumbnail (after the commit point; unregistered).
    if (p.cover) await writeCoverThumbnail(lm, meta.slug, p.cover.bytes);

    return { status: "imported", docId: meta.id, title: p.title };
  } catch (e) {
    if (e instanceof ImportError) {
      return { status: "refused", error: e.message, errorCode: e.code };
    }
    return { status: "refused", error: e instanceof Error ? e.message : "Import failed" };
  }
}

/** Replace = keep the OLD doc's id, slug, tags, collections, annotations, progress
 * (06 §1.6 replaceDoc parity): delete the folder, re-run the pipeline under the
 * same identity, manifest last. */
export async function replaceDoc(
  lm: LibraryManager,
  oldDocId: string,
  fileName: string,
  bytes: Uint8Array,
  formatHint?: SourceFormatDetect,
  contentHashOverride?: string,
): Promise<ImportResult> {
  try {
    const manifest = await lm.load();
    const md = manifest?.docs.find((d) => d.id === oldDocId);
    if (!md) return { status: "refused", error: "Original document not found" };
    const oldMeta = await lm.meta.read(md.slug);
    const contentHash = contentHashOverride ?? (await sha256HexOf(bytes));
    const format = formatHint ?? detectFormat(fileName, bytes);

    const p = await runPipeline(fileName, bytes, format, contentHash);
    const meta: DocMeta = {
      schema: 1,
      id: oldDocId,
      slug: md.slug,
      title: p.title,
      author: p.author,
      kind: p.kind,
      language: p.language,
      sourceFormat: p.sourceFormat,
      sourceUrl: oldMeta?.sourceUrl ?? null,
      sourceName: oldMeta?.sourceName ?? null,
      capturedAt: oldMeta?.capturedAt ?? nowIso(),
      importedAt: nowIso(),
      contentHash,
      wordCount: p.wordCount,
      searchable: p.searchable,
      tags: oldMeta?.tags ?? [],
      collectionIds: oldMeta?.collectionIds ?? [],
      files: buildMetaFiles(p),
      chapters: p.chapters,
    };

    // delete old folder + old index first; annotations/progress stay (same docId)
    await lm.deleteFolderOnly(L.docDir(lm.root, md.slug));
    await lm.addDoc({ meta, files: filesMapFor(p) });

    if (p.sourceFormat !== "pdf") {
      const textByChapter = new Map(p.chapters.map((c, i) => [c.id, p.chapterTexts[i] ?? ""]));
      await writeIndex(lm, meta.id, p.chapters, textByChapter);
    } else {
      // the old index belongs to the old file — drop it; the background job
      // (or reconcileIndexes) rebuilds from the new bytes
      await lm.deleteFolderOnly(L.indexText(lm.root, meta.id));
    }

    // L3: additive shelf thumbnail (replaceDoc re-derives it too).
    if (p.cover) await writeCoverThumbnail(lm, meta.slug, p.cover.bytes);

    return { status: "replaced", docId: meta.id, title: p.title };
  } catch (e) {
    if (e instanceof ImportError) {
      return { status: "refused", error: e.message, errorCode: e.code };
    }
    return { status: "refused", error: e instanceof Error ? e.message : "Replace failed" };
  }
}

export { ext, stem };
