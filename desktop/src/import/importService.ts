// Import pipeline orchestration (02 §6): detect → dedup gate → build → write
// doc folder → meta.json → index/text/<docId>.json → manifest rewrite LAST
// (via LibraryManager.addDoc, which owns the commit point).
import { assertImportable, detectFormat, ImportError, type SourceFormatDetect } from "./fileDetector";
import { sha256Hex } from "../lib/sha256";
import { parseEpub } from "./epubImporter";
import { importHtml, importTxt, type ArticleImport } from "./articleImporters";
import { buildEpub } from "./clip/epubBuilder";
import type { LibraryManager } from "../store/libraryManager";
import type { DocMeta, DocKind, SourceFormat } from "../model/types";
import { nowIso, newUuid } from "../model/ids";
import { libraryLayout as L } from "../lib/libraryPaths";

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

function stem(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  const i = base.lastIndexOf(".");
  return (i === -1 ? base : base.slice(0, i)).trim() || "Untitled";
}

async function sha256HexOf(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

async function runPipeline(
  fileName: string,
  bytes: Uint8Array,
  format: SourceFormatDetect,
  contentHash: string
): Promise<{
  title: string;
  author: string | null;
  kind: DocKind;
  language: string;
  sourceFormat: SourceFormat;
  chapters: DocMeta["chapters"];
  readingEpub: Uint8Array;
  originalName: string;
  originalBytes: Uint8Array;
  cleanHtml: string | null;
  imageFiles: Record<string, Uint8Array>;
  cover: { name: string; bytes: Uint8Array } | null;
  wordCount: number | null;
  /** plain text per chapter, aligned with chapters */
  chapterTexts: string[];
}> {
  const originalName = format === "epub" ? "book.epub" : format === "html" ? "page.html" : "book.txt";
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
      readingEpub: bytes,
      originalName,
      originalBytes: bytes,
      cleanHtml: null,
      imageFiles: {},
      cover: parsed.cover
        ? { name: `cover.${parsed.cover.ext === "jpeg" ? "jpg" : parsed.cover.ext}`, bytes: parsed.cover.bytes }
        : null,
      wordCount: null,
      chapterTexts: parsed.chapters.map((c) => c.text),
    };
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
    readingEpub: built.bytes,
    originalName,
    originalBytes: bytes,
    cleanHtml: article.cleanHtml || null,
    imageFiles,
    cover: null,
    wordCount: article.wordCount || null,
    chapterTexts: article.chapters.map((c) => c.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()),
  };
}

function filesMapFor(p: Awaited<ReturnType<typeof runPipeline>>): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {
    [`original/${p.originalName}`]: p.originalBytes,
    "reading/book.epub": p.readingEpub,
  };
  if (p.cleanHtml !== null) files["clean/index.html"] = new TextEncoder().encode(p.cleanHtml);
  for (const [rel, bytes] of Object.entries(p.imageFiles)) files[rel] = bytes;
  if (p.cover) files[p.cover.name] = p.cover.bytes;
  return files;
}

async function writeIndex(
  lm: LibraryManager,
  docId: string,
  chapters: { id: string; title: string; order: number }[],
  textByChapter: Map<string, string> | null
): Promise<void> {
  const index = {
    schema: 1 as const,
    chapters: chapters.map((c) => ({
      id: c.id,
      title: c.title,
      order: c.order,
      text: textByChapter?.get(c.id) ?? "",
    })),
  };
  await lm.writeFileAtomic(
    L.indexText(lm.root, docId),
    new TextEncoder().encode(JSON.stringify(index))
  );
}

export async function importFile(
  lm: LibraryManager,
  fileName: string,
  bytes: Uint8Array,
  onDuplicate?: (existingTitle: string) => Promise<DuplicateResolution>
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
      if (resolution === "replace") return replaceDoc(lm, existing.id, fileName, bytes, format, contentHash);
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
      searchable: true,
      tags: [],
      collectionIds: [],
      files: {
        original: `original/${p.originalName}`,
        clean: p.cleanHtml !== null ? "clean/index.html" : null,
        reading: "reading/book.epub",
        cover: p.cover ? p.cover.name : null,
      },
      chapters: p.chapters,
    };
    await lm.addDoc({ meta, files: filesMapFor(p) });

    const textByChapter = new Map(
      p.chapters.map((c, i) => [c.id, p.chapterTexts[i] ?? ""])
    );
    await writeIndex(lm, meta.id, p.chapters, textByChapter);

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
  contentHashOverride?: string
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
      searchable: true,
      tags: oldMeta?.tags ?? [],
      collectionIds: oldMeta?.collectionIds ?? [],
      files: {
        original: `original/${p.originalName}`,
        clean: p.cleanHtml !== null ? "clean/index.html" : null,
        reading: "reading/book.epub",
        cover: p.cover ? p.cover.name : null,
      },
      chapters: p.chapters,
    };

    // delete old folder + old index first; annotations/progress stay (same docId)
    await lm.deleteFolderOnly(L.docDir(lm.root, md.slug));
    await lm.addDoc({ meta, files: filesMapFor(p) });

    const textByChapter = new Map(
      p.chapters.map((c, i) => [c.id, p.chapterTexts[i] ?? ""])
    );
    await writeIndex(lm, meta.id, p.chapters, textByChapter);

    return { status: "replaced", docId: meta.id, title: p.title };
  } catch (e) {
    if (e instanceof ImportError) {
      return { status: "refused", error: e.message, errorCode: e.code };
    }
    return { status: "refused", error: e instanceof Error ? e.message : "Replace failed" };
  }
}

export { ext, stem };
