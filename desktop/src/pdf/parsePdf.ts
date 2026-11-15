// Import-time PDF parsing (PDF plan §6.3): metadata, outline, page count,
// cover and text-layer detection, run once during import. meta.json is
// treated as immutable afterwards (the manifest records its hash at addDoc),
// so `searchable` and `wordCount` are decided here from a first-20-pages
// sample rather than after background indexing.
import {
  classifyPdfError,
  openPdf,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "./pdfjsAdapter";
import { countWords, extractPageText } from "./pdfText";
import { COPY, ImportError, detectLanguage, stem } from "../import/fileDetector";
import { FEATURES } from "../lib/features";

export interface PdfOutlineEntry {
  /** outline title, trimmed ("" allowed; UI falls back to the page label) */
  title: string;
  /** 1-based physical page */
  page: number;
}

export interface PdfFirstPageSize {
  width: number;
  height: number;
}

export interface PdfParseOptions {
  signal?: AbortSignal;
  /** 0..1 across the whole parse (loading, then the first-pages sample). */
  onProgress?: (fraction: number) => void;
}

export interface PdfParseResult {
  pageCount: number;
  title: string;
  author: string | null;
  /** resolved outline, de-duplicated by page, in document order */
  outline: PdfOutlineEntry[];
  firstPageSize: PdfFirstPageSize | null;
  /** JPEG page-1 thumbnail (≤480 px wide, q 0.82); null is acceptable */
  cover: { name: string; bytes: Uint8Array } | null;
  /** text of the sampled first pages, joined (language + word-count sample) */
  sampleText: string;
  /** false when the text layer averages < ~20 chars/page (scanned PDF) */
  searchable: boolean;
  estimatedWordCount: number | null;
  language: "en" | "hi";
}

const SAMPLE_PAGES = 20;
const SAMPLE_CHARS_PER_PAGE = 20;
const COVER_MAX_WIDTH = 480;
const COVER_QUALITY = 0.82;
const PARSE_TIMEOUT_MS = 30_000;
const MAX_OUTLINE_ENTRIES = 5_000;
const TITLE_MAX_CHARS = 300;

/** Strip control characters and collapse whitespace (plan §6.3). */
function cleanMetaString(value: unknown): string {
  if (typeof value !== "string") return "";
  return (
    value
      // eslint-disable-next-line no-control-regex -- stripping control chars is the point
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, TITLE_MAX_CHARS)
  );
}

function isJunkTitle(title: string): boolean {
  const s = title.trim();
  if (!s || s.length <= 1) return true;
  if (/^\d+$/.test(s)) return true;
  if (/\.(docx?|indd|tex|pdf)(\s|$)/i.test(s)) return true;
  if (/^Microsoft Word - /i.test(s)) return true;
  if (/^Untitled$/i.test(s)) return true;
  return false;
}

/** XMP dc:title/dc:creator fallback (info dict often junk or missing). */
function xmpValue(rawXmp: unknown, tag: "dc:title" | "dc:creator"): string {
  if (typeof rawXmp !== "string") return "";
  const match = rawXmp.match(
    new RegExp(`<${tag}[^>]*>(?:<rdf:Alt[^>]*>)?(?:<rdf:li[^>]*>)?([\\s\\S]*?)(?:</rdf:li>)?`),
  );
  const raw = match?.[1] ?? "";
  return cleanMetaString(raw.replace(/<[^>]*>/g, " "));
}

/** Resolve one outline item's dest to a 1-based page, or null when it cannot
 *  be resolved or is a URL action (plan §6.3). */
async function resolveOutlinePage(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    let resolved: unknown = dest;
    if (typeof resolved === "string") {
      resolved = await doc.getDestination(resolved);
      if (!resolved) return null;
    }
    if (Array.isArray(resolved) && resolved.length > 0) {
      const first = resolved[0];
      if (typeof first === "number") return first + 1; // explicit page index
      // A reference object → page index (slow path; getDestination is preferred)
      const index = await doc.getPageIndex(first as never);
      return Number.isFinite(index) ? index + 1 : null;
    }
    return null;
  } catch {
    return null;
  }
}

interface OutlineWalkState {
  out: PdfOutlineEntry[];
  seenPages: Set<number>;
  seenIds: Set<string>;
}

/** Depth-first outline walk with cycle guard and the 5,000-entry cap. */
async function walkOutline(
  doc: PDFDocumentProxy,
  items: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>,
  depth: number,
  state: OutlineWalkState,
): Promise<void> {
  if (state.out.length >= MAX_OUTLINE_ENTRIES) return;
  for (const item of items) {
    if (state.out.length >= MAX_OUTLINE_ENTRIES) return;
    if (item.dest === null || item.dest === undefined) continue;
    if ("url" in item && item.url) continue; // URI action, not a page
    const id = typeof item.dest === "string" ? `s:${item.dest}` : null;
    if (id && state.seenIds.has(id)) continue; // cycle guard
    const page = await resolveOutlinePage(doc, item.dest);
    if (id) state.seenIds.add(id);
    if (page !== null && !state.seenPages.has(page)) {
      state.seenPages.add(page);
      state.out.push({ title: cleanMetaString(item.title), page });
    }
    const children = (item as { items?: unknown }).items;
    if (Array.isArray(children) && children.length > 0 && depth < 32) {
      await walkOutline(doc, children as never, depth + 1, state);
    }
  }
}

/** Render page 1 to a JPEG cover (≤480 px). Browser-only; Node and any
 *  rendering failure yield null — the tint placeholder covers that. */
async function renderCover(
  page1: PDFPageProxy,
): Promise<{ name: string; bytes: Uint8Array } | null> {
  try {
    if (typeof document === "undefined") return null;
    const base = page1.getViewport({ scale: 1 });
    const scale = Math.min(1, COVER_MAX_WIDTH / base.width);
    const viewport = page1.getViewport({ scale: Math.max(scale, 0.05) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page1.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", COVER_QUALITY),
    );
    if (!blob) return null;
    return { name: "cover.jpg", bytes: new Uint8Array(await blob.arrayBuffer()) };
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Parse a PDF for import. Copies the bytes first: pdf.js transfers its buffer
 * to the worker and detaches it, and the original bytes must still reach
 * `addDoc` (plan §6.3). Always destroys the loading task in `finally`.
 */
export async function parsePdf(
  fileName: string,
  bytes: Uint8Array,
  options: PdfParseOptions = {},
): Promise<PdfParseResult> {
  if (!FEATURES.pdf) throw new ImportError("pdf", COPY.pdf);

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), PARSE_TIMEOUT_MS);
  const onExternalAbort = () => timeout.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  let opened: Awaited<ReturnType<typeof openPdf>> | null = null;
  try {
    // Copy so the worker transfer cannot detach the caller's buffer.
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);

    opened = await openPdf(copy, {
      signal: timeout.signal,
      onProgress: (fraction) => options.onProgress?.(fraction === null ? 0 : fraction * 0.7),
    });
    const doc = opened.doc;

    if (doc.numPages === 0) throw new ImportError("unreadable", COPY.noPages);

    const page1 = await doc.getPage(1);
    const vp = page1.getViewport({ scale: 1 });
    const firstPageSize: PdfFirstPageSize = { width: vp.width, height: vp.height };

    // ---- metadata ----------------------------------------------------------
    let title = "";
    let author: string | null = null;
    try {
      const meta = await doc.getMetadata();
      title = cleanMetaString((meta.info as { Title?: unknown }).Title);
      const rawAuthor = cleanMetaString((meta.info as { Author?: unknown }).Author);
      author = rawAuthor.length > 0 ? rawAuthor : null;
      if (isJunkTitle(title) || title.length === 0) {
        title = xmpValue(meta.metadata?.getRaw?.(), "dc:title");
        if (author === null) {
          const xmpAuthor = xmpValue(meta.metadata?.getRaw?.(), "dc:creator");
          if (xmpAuthor.length > 0) author = xmpAuthor;
        }
      }
    } catch {
      /* metadata is optional */
    }
    if (isJunkTitle(title)) title = stem(fileName);

    // ---- outline -----------------------------------------------------------
    let outline: PdfOutlineEntry[] = [];
    try {
      const outlineRaw = await doc.getOutline();
      if (outlineRaw && outlineRaw.length > 0) {
        const state: OutlineWalkState = { out: [], seenPages: new Set(), seenIds: new Set() };
        await walkOutline(doc, outlineRaw, 0, state);
        outline = state.out;
      }
    } catch {
      /* a broken outline must not fail the import */
    }

    // ---- first-pages sample: text layer detection, word count, language ----
    const sampleCount = Math.min(SAMPLE_PAGES, doc.numPages);
    const pageTexts: string[] = [];
    let cover: { name: string; bytes: Uint8Array } | null = null;
    for (let i = 1; i <= sampleCount; i++) {
      const page = i === 1 ? page1 : await doc.getPage(i);
      if (i === 1) {
        cover = await renderCover(page1);
        page1.cleanup();
      }
      try {
        pageTexts.push(await extractPageText(page));
        page.cleanup();
      } catch {
        pageTexts.push("");
      }
      options.onProgress?.(0.7 + 0.3 * (i / sampleCount));
    }
    const sampleText = pageTexts.join("\n");
    const avgChars =
      pageTexts.length > 0
        ? pageTexts.reduce((sum, t) => sum + t.trim().length, 0) / pageTexts.length
        : 0;
    const searchable = pageTexts.length > 0 && avgChars >= SAMPLE_CHARS_PER_PAGE;
    const wordsPerPage = sampleCount > 0 ? countWords(sampleText) / sampleCount : 0;
    const estimatedWordCount = searchable ? Math.round(wordsPerPage * doc.numPages) : null;
    const language = detectLanguage(sampleText);

    return {
      pageCount: doc.numPages,
      title,
      author,
      outline,
      firstPageSize,
      cover,
      sampleText,
      searchable,
      estimatedWordCount,
      language,
    };
  } catch (error) {
    const classified = classifyPdfError(error);
    if (classified) {
      throw new ImportError(classified.code, classified.message);
    }
    if (isAbortError(error)) throw error;
    if (error instanceof ImportError) throw error;
    throw new ImportError("unreadable", COPY.invalidPdf);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
    await opened?.destroy().catch(() => {});
  }
}
