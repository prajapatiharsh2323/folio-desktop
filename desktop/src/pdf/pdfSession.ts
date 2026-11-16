// Non-DOM document state for the PDF reader (PDF plan §7): the opened pdf.js
// document, per-page sizes, zoom/spread state, layout, page labels, outline
// TOC and locator mapping. All browser work (canvas painting, scroll events)
// lives in pdfEngine/pdfPageView — this class is unit-testable in Node.
import type { PDFDocumentProxy } from "./pdfjsAdapter";
import {
  effectiveSpread,
  hrefForPage,
  layoutPages,
  offsetForPage,
  pageAtOffset,
  pageForProgression,
  pageFromHref,
  progressionForPage,
  stepZoom,
  type PageLayout,
  type PageSize,
  type ViewportSize,
  type ZoomMode,
} from "./pdfLayout";
import type { TocEntry } from "../reader/ReaderEngine";
import type { ReadingPrefs } from "../model/types";
import { extractPageText } from "./pdfText";

export interface PdfOutlineRaw {
  title: string | null;
  dest: unknown;
  items?: PdfOutlineRaw[];
  url?: string | null;
}

export interface OutlineSection {
  title: string;
  page: number;
  depth: number;
}

const MAX_TOC_ENTRIES = 5_000;
const MAX_TOC_DEPTH = 32;
const MAX_TEXT_CACHE_ENTRIES = 500;

export class PdfSession {
  private doc: PDFDocumentProxy;
  private _pageCount: number;
  private sizes: PageSize[] = [];
  private _pageLabels: string[] | null = null;
  private _toc: TocEntry[] = [];
  private sections: OutlineSection[] = [];
  private _zoom: ZoomMode;
  private _spreadPref: ReadingPrefs["spread"];
  private _viewport: ViewportSize = { width: 800, height: 1000 };
  private layout: PageLayout | null = null;
  private textCache = new Map<number, string>();
  /** 1-based page the reading line sits on */
  private _page = 1;

  private constructor(
    doc: PDFDocumentProxy,
    pageCount: number,
    zoom: ZoomMode,
    spreadPref: ReadingPrefs["spread"],
  ) {
    this.doc = doc;
    this._pageCount = pageCount;
    this._zoom = zoom;
    this._spreadPref = spreadPref;
  }

  /** Open and take the page survey. Page sizes come from pdf.js viewports;
   *  labels and the outline are best-effort (a broken one must not fail
   *  the open). */
  static async open(
    doc: PDFDocumentProxy,
    prefs: ReadingPrefs,
    onProgress?: (fraction: number) => void,
  ): Promise<PdfSession> {
    const session = new PdfSession(doc, doc.numPages, "fit-width", prefs.spread);
    const count = doc.numPages;
    const sizes: PageSize[] = [];
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      sizes.push({ width: vp.width, height: vp.height });
      if (onProgress && i % 25 === 0) onProgress(i / count);
    }
    session.sizes = sizes;
    session._pageLabels = (await doc.getPageLabels().catch(() => null)) ?? null;
    session._toc = await session.buildToc();
    if (onProgress) onProgress(1);
    return session;
  }

  get pageCount(): number {
    return this._pageCount;
  }

  get page(): number {
    return this._page;
  }

  get zoom(): ZoomMode {
    return this._zoom;
  }

  get spreadPref(): ReadingPrefs["spread"] {
    return this._spreadPref;
  }

  get viewport(): ViewportSize {
    return this._viewport;
  }

  pageSize(page: number): PageSize {
    return (
      this.sizes[Math.min(this.sizes.length, Math.max(1, page)) - 1] ?? { width: 612, height: 792 }
    );
  }

  /** Display label for a page (plan §7.5: "iv", "A-3"); 1-based physical. */
  pageLabel(page: number): string | undefined {
    const label = this._pageLabels?.[page - 1];
    return label && label.trim() !== "" ? label : undefined;
  }

  get toc(): TocEntry[] {
    return this._toc;
  }

  /** Cached page text (joinTextItems normalisation) for selection context
   *  and in-book search. Small (≈2 KB/page); bounded cache for very long
   *  documents. */
  async pageText(page: number): Promise<string> {
    const cached = this.textCache.get(page);
    if (cached !== undefined) return cached;
    const proxy = await this.doc.getPage(page);
    const text = await extractPageText(proxy);
    if (this.textCache.size >= MAX_TEXT_CACHE_ENTRIES) {
      const oldest = this.textCache.keys().next().value;
      if (oldest !== undefined) this.textCache.delete(oldest);
    }
    this.textCache.set(page, text);
    return text;
  }

  /** Outline sections in document order (title + first page + nesting depth). */
  private async buildToc(): Promise<TocEntry[]> {
    let raw: PdfOutlineRaw[];
    try {
      raw = ((await this.doc.getOutline()) as PdfOutlineRaw[] | null) ?? [];
    } catch {
      raw = [];
    }
    const sections: OutlineSection[] = [];
    if (raw && raw.length > 0) {
      const seen = new Set<number>();
      const walk = async (items: PdfOutlineRaw[], depth: number): Promise<void> => {
        for (const item of items) {
          if (sections.length >= MAX_TOC_ENTRIES || depth > MAX_TOC_DEPTH) return;
          if (item.url) continue; // URI action, not a page
          const page = await this.resolveDestPage(item.dest);
          if (page !== null && !seen.has(page)) {
            seen.add(page);
            sections.push({ title: (item.title ?? "").trim(), page, depth });
          }
          if (item.items && item.items.length > 0) await walk(item.items, depth + 1);
        }
      };
      await walk(raw, 0);
    }
    this.sections = sections;
    if (sections.length === 0) {
      // No outline: the TOC degenerates to chapter-free page groups so the
      // contents panel still offers navigation (plan §5 synthetic chapters).
      const groupSize = Math.max(1, Math.ceil(this._pageCount / 40));
      const out: TocEntry[] = [];
      for (let start = 1; start <= this._pageCount; start += groupSize) {
        const end = Math.min(this._pageCount, start + groupSize - 1);
        out.push({
          title: end === start ? `Page ${start}` : `Pages ${start}–${end}`,
          href: hrefForPage(start),
          depth: 0,
        });
      }
      return out;
    }
    return sections.map((s) => ({
      title: s.title || `Page ${s.page}`,
      href: hrefForPage(s.page),
      depth: s.depth,
    }));
  }

  private async resolveDestPage(dest: unknown): Promise<number | null> {
    try {
      let resolved: unknown = dest;
      if (typeof resolved === "string") {
        resolved = await this.doc.getDestination(resolved);
        if (!resolved) return null;
      }
      if (Array.isArray(resolved) && resolved.length > 0) {
        const first = resolved[0];
        if (typeof first === "number") return first + 1;
        const index = await this.doc.getPageIndex(first as never);
        return Number.isFinite(index) ? index + 1 : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Title of the outline section containing the current page (chapter pill). */
  sectionTitleFor(page: number): string | undefined {
    let best: OutlineSection | null = null;
    for (const s of this.sections) {
      if (s.page <= page) best = s;
      else break;
    }
    return best ? best.title || `Page ${best.page}` : undefined;
  }

  setViewport(viewport: ViewportSize): void {
    this._viewport = viewport;
    this.layout = null;
  }

  setSpreadPref(pref: ReadingPrefs["spread"]): void {
    this._spreadPref = pref;
    this.layout = null;
  }

  setZoom(zoom: ZoomMode): void {
    this._zoom = zoom;
    this.layout = null;
  }

  /** Zoom in/out by a geometric step; returns the new absolute zoom. */
  zoomBy(direction: 1 | -1): number {
    const next = stepZoom(this._zoom, direction, this.pageSize(this._page), this._viewport);
    this._zoom = next;
    this.layout = null;
    return next;
  }

  private ensureLayout(): PageLayout {
    if (!this.layout) {
      const spread = effectiveSpread(this._spreadPref, this._viewport);
      // layoutPages scales every page against one reference so fit modes and
      // spreads never reflow mid-document.
      this.layout = layoutPages(this.sizes, this._viewport, this._zoom, spread);
    }
    return this.layout;
  }

  get currentLayout(): PageLayout {
    return this.ensureLayout();
  }

  /** Content-space scroll offset that brings a page in. */
  offsetForPage(page: number): number {
    const layout = this.ensureLayout();
    return offsetForPage(layout.placements, page, this._viewport, layout.totalHeight);
  }

  /** 1-based page under a scroll offset. */
  pageAtOffset(offsetY: number): number {
    return pageAtOffset(this.ensureLayout().placements, offsetY);
  }

  /** Sync the reading line from a scroll offset; returns true when the page
   *  changed (locator emission gate). */
  syncFromOffset(offsetY: number): boolean {
    const page = this.pageAtOffset(offsetY);
    if (page === this._page) return false;
    this._page = page;
    return true;
  }

  goToPage(page: number): void {
    this._page = Math.min(this._pageCount, Math.max(1, page));
  }

  progression(): number {
    return progressionForPage(this._page, this._pageCount);
  }

  goToProgression(progression: number): void {
    this._page = pageForProgression(progression, this._pageCount);
  }

  /** Zoom scale actually used to render the current page (CSS px per pt). */
  renderScale(): number {
    const layout = this.ensureLayout();
    const p = layout.placements[Math.min(this._pageCount, this._page) - 1];
    if (!p) return 1;
    return p.width / this.pageSize(this._page).width;
  }

  locator(location: string): {
    location: string;
    progression: number;
    page: number;
    pageCount: number;
    pageLabel?: string;
    chapterTitle?: string;
    chapterHref?: string;
  } {
    return {
      location,
      progression: this.progression(),
      page: this._page,
      pageCount: this._pageCount,
      pageLabel: this.pageLabel(this._page),
      chapterTitle: this.sectionTitleFor(this._page),
      chapterHref: hrefForPage(this._page),
    };
  }

  /** Parse a persisted/open-target locator ("page-N") or percent. */
  pageFromTarget(
    target: { location?: string | null; percent?: number | null } | null | undefined,
  ): number | null {
    if (!target) return null;
    const page = pageFromHref(target.location);
    if (page !== null) return page;
    if (typeof target.percent === "number" && Number.isFinite(target.percent)) {
      return pageForProgression(target.percent / 100, this._pageCount);
    }
    return null;
  }

  /** Pages visible (or near-visible) for a scroll offset — the render
   *  window. Returns [first, last] 1-based inclusive. */
  visibleRange(offsetY: number, viewHeight: number, margin: number = 2): [number, number] {
    const layout = this.ensureLayout();
    const top = offsetY;
    const bottom = offsetY + viewHeight;
    let first = this._pageCount;
    let last = 1;
    for (const p of layout.placements) {
      if (p.top + p.height >= top && p.top <= bottom) {
        first = Math.min(first, p.page);
        last = Math.max(last, p.page);
      }
    }
    if (first > last) {
      // off-content scroll (rubber band): fall back to the nearest page
      const nearest = this.pageAtOffset(offsetY);
      return [nearest, nearest];
    }
    return [Math.max(1, first - margin), Math.min(this._pageCount, last + margin)];
  }

  /** The pdf.js document (pages are rendered through pdfPageView). */
  get document(): PDFDocumentProxy {
    return this.doc;
  }
}
