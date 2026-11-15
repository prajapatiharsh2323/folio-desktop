// The only module allowed to import pdfjs-dist (PDF plan §2 rule 7). The
// pdf.js API shifts between majors — the render, text-layer and option
// surfaces changed across 4.x/5.x/6.x — so version bumps must touch this
// file and nothing else.
//
// Security posture (plan §14, verified against pdfjs-dist 6.5.438):
// - No `eval` exists in the 6.x build at all, so CVE-2024-4367
//   (`isEvalSupported`) is structurally fixed; the option no longer exists.
// - `enableScripting` lives only in the optional annotation/scripting layers,
//   which Folio never instantiates, so CVE-2026-16633 cannot be reached.
//   Both advisories double-checked when choosing 6.5.438 (patched 6.2.108+).
//
// Loading is lazy: the dynamic import runs the first time a PDF is imported
// or opened, so EPUB users pay no startup or memory cost (rule 5).
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextLayer as PdfjsTextLayer,
  getDocument as GetDocument,
  version as Version,
} from "pdfjs-dist";

type PdfjsLib = {
  getDocument: typeof GetDocument;
  version: typeof Version;
  GlobalWorkerOptions: { workerSrc: string };
  TextLayer: typeof PdfjsTextLayer;
};

function isNodeRuntime(): boolean {
  return typeof window === "undefined" || typeof document === "undefined";
}

let libPromise: Promise<PdfjsLib> | null = null;

/** Static pdf.js data assets, copied to dist/pdfjs/ by vite-plugin-static-copy. */
export const pdfAssetUrls = {
  get cmaps(): string {
    return `${import.meta.env.BASE_URL}pdfjs/cmaps/`;
  },
  get standardFonts(): string {
    return `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`;
  },
  get wasm(): string {
    return `${import.meta.env.BASE_URL}pdfjs/wasm/`;
  },
};

async function importPdfjs(): Promise<PdfjsLib> {
  if (isNodeRuntime()) {
    // getDocument in Node requires the legacy build (no Worker/WebView APIs).
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLib;
  }
  return (await import("pdfjs-dist")) as unknown as PdfjsLib;
}

/**
 * Load pdf.js once and configure the worker. The worker is imported as a URL
 * asset so Vite emits it next to the bundle; it stays same-origin ('self'
 * under the CSP) and never needs 'unsafe-eval'.
 */
export async function loadPdfjs(): Promise<PdfjsLib> {
  if (!libPromise) {
    libPromise = (async () => {
      const lib = await importPdfjs();
      if (!isNodeRuntime()) {
        const workerUrl = (await import(
          // Vite `?url`: emits the worker as an asset, returns its URL.
          "pdfjs-dist/build/pdf.worker.min.mjs?url"
        )) as { default: string };
        lib.GlobalWorkerOptions.workerSrc = workerUrl.default;
      }
      return lib as unknown as PdfjsLib;
    })();
    // Never leave a rejected promise cached: a transient failure must be
    // retryable (reader Retry reloads the document from scratch).
    libPromise.catch(() => {
      libPromise = null;
    });
  }
  return libPromise;
}

export type PdfPasswordError = { code: "encrypted"; message: string };
export type PdfParseError = { code: "unreadable"; message: string };

export interface OpenPdfOptions {
  /** Aborts by destroying the loading task (6.x getDocument has no signal
   *  option; plan §14's 30 s parse timeout cancels this way). */
  signal?: AbortSignal;
  /** Loading progress 0..1 when the total size is known. */
  onProgress?: (fraction: number | null) => void;
  /** Optional password (v1.1 prompt); absent ⇒ encrypted files are refused. */
  password?: string;
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Cancels the loading task and destroys the document. Idempotent. */
  destroy(): Promise<void>;
}

/** Classify a thrown pdf.js error against the plan's user-facing codes. */
export function classifyPdfError(error: unknown): PdfPasswordError | PdfParseError | null {
  const name = (error as { name?: string } | null)?.name;
  if (name === "PasswordException") {
    return {
      code: "encrypted",
      message: "This PDF is password protected. Remove the password and import it again.",
    };
  }
  if (name === "InvalidPDFException") {
    return { code: "unreadable", message: "This file isn't a valid PDF" };
  }
  return null;
}

/**
 * Open a PDF from bytes. Callers that hand over their only buffer must pass a
 * copy: pdf.js transfers the buffer to its worker and detaches it
 * (plan §6.3 — parsePdf slices first; the bytes must still be written to
 * disk afterwards).
 */
export async function openPdf(bytes: Uint8Array, options: OpenPdfOptions = {}): Promise<OpenedPdf> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: bytes,
    cMapUrl: pdfAssetUrls.cmaps,
    cMapPacked: true,
    standardFontDataUrl: pdfAssetUrls.standardFonts,
    wasmUrl: pdfAssetUrls.wasm,
    enableXfa: false,
    verbosity: 0, // ERRORS only
    useSystemFonts: true,
    password: options.password,
  });
  if (options.onProgress) {
    task.onProgress = (data: { loaded: number; total: number }) => {
      options.onProgress!(data.total > 0 ? Math.min(1, data.loaded / data.total) : null);
    };
  }
  let destroyed = false;
  const destroy = async (): Promise<void> => {
    if (destroyed) return;
    destroyed = true;
    await task.destroy();
  };
  const onAbort = () => void destroy();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const doc = await task.promise;
    options.signal?.removeEventListener("abort", onAbort);
    return { doc, destroy };
  } catch (error) {
    await destroy().catch(() => {});
    if (options.signal?.aborted) {
      throw new DOMException("PDF loading aborted", "AbortError");
    }
    throw error;
  }
}

export type { PDFDocumentProxy, PDFPageProxy };

/**
 * Render a pdf.js text layer into `container` (PDF plan §7.4 — selection and
 * search substrates). `source` is a page's TextContent
 * (`page.getTextContent()`); `viewport` must be the page viewport at the
 * CSS display scale — pdf.js TextLayer multiplies by devicePixelRatio
 * internally. The layer only positions spans; styling lives in pdf.css
 * (.folio-pdf-textlayer, copied from pdf_viewer.css — Apache-2.0).
 */
export async function renderPdfTextLayer(
  source: unknown,
  container: HTMLElement,
  viewport: unknown,
): Promise<void> {
  const lib = await loadPdfjs();
  const layer = new lib.TextLayer({
    textContentSource: source as never,
    container,
    viewport: viewport as never,
  });
  await layer.render();
}

/** The page viewport the text layer expects (CSS scale, no dpr scaling). */
export function textLayerViewport(
  page: PDFPageProxy,
  scale: number,
): ReturnType<PDFPageProxy["getViewport"]> {
  return page.getViewport({ scale });
}

// ---- link annotations (hardening phase, plan §12) ---------------------------

/** One clickable link region on a page, in CSS px relative to the page box
 *  origin, with exactly one target: internal `page` (1-based) or external
 *  `url`. Resolving annotations here keeps the pdf.js import rule intact. */
export interface PdfPageLink {
  rect: { left: number; top: number; right: number; bottom: number };
  /** Internal destination page (1-based); null for non-document targets. */
  page: number | null;
  /** External URI target (http/https enforced by the openExternal gate). */
  url: string | null;
}

/** First page number (1-based) a destination array points at, or null when
 *  it cannot be resolved (dangling/named dests are simply skipped). */
async function destPage(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  if (!Array.isArray(dest) || dest.length === 0) return null;
  const ref = dest[0] as { num?: number } | number | null;
  try {
    return (await doc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0])) + 1;
  } catch {
    return null;
  }
}

/**
 * Link annotations of one page as CSS-px rects relative to the page box.
 * `scale` is the layout scale (CSS px per point) the page is rendered at —
 * the engine re-queries when zoom changes, so results are never scaled
 * client-side. GoTo dests resolve through the document; unresolved or
 * non-link annotations are skipped.
 */
export async function pageLinkRects(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
): Promise<PdfPageLink[]> {
  const page = await doc.getPage(pageNumber);
  const annots = (await page.getAnnotations()) as Array<Record<string, unknown>>;
  const viewport = page.getViewport({ scale });
  const out: PdfPageLink[] = [];
  for (const annot of annots) {
    if (annot.subtype !== "Link") continue;
    const rect = annot.rect as number[] | undefined;
    if (!rect || rect.length !== 4) continue;
    const [vx1, vy1] = viewport.convertToViewportPoint(rect[0], rect[1]);
    const [vx2, vy2] = viewport.convertToViewportPoint(rect[2], rect[3]);
    const box = {
      left: Math.min(vx1, vx2),
      top: Math.min(vy1, vy2),
      right: Math.max(vx1, vx2),
      bottom: Math.max(vy1, vy2),
    };
    let targetPage: number | null = null;
    let url: string | null = null;
    if (typeof annot.dest === "string") {
      const named = await doc.getDestination(annot.dest);
      targetPage = named ? await destPage(doc, named) : null;
    } else if (annot.dest != null) {
      targetPage = await destPage(doc, annot.dest);
    }
    if (targetPage === null && typeof annot.url === "string") {
      url = annot.url;
    }
    if (targetPage === null && url === null) continue;
    out.push({ rect: box, page: targetPage, url });
  }
  return out;
}
