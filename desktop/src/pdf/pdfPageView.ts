// Canvas render queue for PDF pages (PDF plan §7.2/§7.4). Owns one box per
// rendered page — a wrapper containing the canvas, the pdf.js text layer
// (selection/search substrate) and the decoration layer (highlights) — and
// renders only the visible window (plus a small margin), evicts far pages,
// and keeps one in-flight render per page with a cancellation token.
//
// Both the canvas renderer and the text-layer factory are injected so the
// queue logic is testable without pdf.js.
import type { PDFDocumentProxy, PDFPageProxy } from "./pdfjsAdapter";
import { renderPdfTextLayer, textLayerViewport } from "./pdfjsAdapter";
import type { PageLayout } from "./pdfLayout";

export interface PageRenderer {
  /** Paint `page` onto an already-sized canvas. The canvas backing store is
   *  sized before the call; `scale` is the layout's CSS px per point. */
  render(
    page: number,
    canvas: HTMLCanvasElement,
    cssWidth: number,
    cssHeight: number,
    scale: number,
    dpr: number,
  ): Promise<void>;
  /** Optional: release pdf.js page resources once its canvas is dropped. */
  release?(page: number): void;
}

/** Fills a page's text-layer container (pdf.js TextLayer in production). */
export interface PageTextFactory {
  attach(
    page: number,
    container: HTMLElement,
    cssWidth: number,
    cssHeight: number,
    scale: number,
  ): Promise<void>;
  release(page: number): void;
}

export interface PageViewHost {
  createElement(tagName: string): HTMLElement;
}

export interface PageBox {
  wrapper: HTMLElement;
  canvas: HTMLCanvasElement;
  text: HTMLElement;
  decorations: HTMLElement;
  /** true once the text factory has filled the text layer */
  textAttached: boolean;
}

const MAX_CANVASES = 8;
/** devicePixelRatio is capped so a 4× display cannot ask for gigantic
 *  canvases (plan §14: memory bound); above 2 the extra sharpness is noise. */
const MAX_DPR = 2;
/** Canvas backing store cap (32 Mpx ≈ 128 MB RGBA) — a very tall page at max
 *  zoom must not allocate unbounded memory. */
const MAX_BACKING_PIXELS = 32_000_000;

interface RenderState extends PageBox {
  /** -1 when the canvas content no longer matches the layout size */
  renderedWidth: number;
  renderedHeight: number;
  /** CSS size the text layer was attached at (-1 = not attached) */
  textWidth: number;
  textHeight: number;
  /** 0 = idle; otherwise the in-flight render's token */
  token: number;
}

export class PdfPageView {
  private container: HTMLElement;
  private host: PageViewHost;
  private renderer: PageRenderer;
  private textFactory: PageTextFactory | null;
  private onTextReady: ((page: number) => void) | null;
  private pages = new Map<number, RenderState>();
  private layer: HTMLElement | null = null;
  private destroyed = false;
  private generation = 0;

  constructor(
    container: HTMLElement,
    renderer: PageRenderer,
    options: {
      textFactory?: PageTextFactory;
      onTextReady?: (page: number) => void;
      host?: PageViewHost;
    } = {},
  ) {
    this.container = container;
    this.renderer = renderer;
    this.textFactory = options.textFactory ?? null;
    this.onTextReady = options.onTextReady ?? null;
    this.host = options.host ?? {
      createElement: (tag: string) => document.createElement(tag),
    };
  }

  /** Sync page boxes with the layout + visible range. Cheap to call often:
   *  positions are updated every time; renders are queued only for dirty or
   *  missing pages inside the range. */
  sync(layout: PageLayout, visible: [number, number], dpr: number): void {
    if (this.destroyed) return;
    const [first, last] = visible;
    this.generation += 1;
    const gen = this.generation;

    let layer = this.layer;
    if (!layer) {
      layer = this.host.createElement("div");
      layer.className = "folio-pdf-layer";
      this.container.appendChild(layer);
      this.layer = layer;
    }

    const effectiveDpr = Math.min(MAX_DPR, Math.max(1, dpr || 1));
    const wanted = new Set<number>();
    for (const p of layout.placements) {
      if (p.page < first || p.page > last) continue;
      wanted.add(p.page);

      let state = this.pages.get(p.page);
      if (!state) {
        state = this.createPageBox(p.page);
        this.pages.set(p.page, state);
      }

      // Position + size every sync (layout may have reflowed).
      state.wrapper.style.left = `${p.left}px`;
      state.wrapper.style.top = `${p.top}px`;
      state.wrapper.style.width = `${p.width}px`;
      state.wrapper.style.height = `${p.height}px`;
      // pdf.js text layer resolves font sizes through --total-scale-factor.
      state.wrapper.style.setProperty("--scale-factor", String(layout.scale));

      const dirty = state.renderedWidth !== p.width || state.renderedHeight !== p.height;
      if (dirty && state.token === 0) {
        this.queueRender(p.page, state, p.width, p.height, layout.scale, gen, effectiveDpr);
      }
      if (this.textFactory && (state.textWidth !== p.width || state.textHeight !== p.height)) {
        this.queueText(p.page, state, p.width, p.height, layout.scale);
      }
    }

    this.evict(wanted);
  }

  private createPageBox(page: number): RenderState {
    const wrapper = this.host.createElement("div");
    wrapper.className = "folio-pdf-pagebox";
    wrapper.dataset.page = String(page);
    const canvas = this.host.createElement("canvas") as HTMLCanvasElement;
    canvas.className = "folio-pdf-page";
    const text = this.host.createElement("div");
    text.className = "folio-pdf-textlayer";
    const decorations = this.host.createElement("div");
    decorations.className = "folio-pdf-decorations";
    wrapper.append(canvas, text, decorations);
    this.layer?.appendChild(wrapper);
    return {
      wrapper,
      canvas,
      text,
      decorations,
      textAttached: false,
      renderedWidth: -1,
      renderedHeight: -1,
      textWidth: -1,
      textHeight: -1,
      token: 0,
    };
  }

  /** Queue a canvas render for one page. One in-flight render per page; a
   *  newer request supersedes an older one via the token. */
  private queueRender(
    page: number,
    state: RenderState,
    cssWidth: number,
    cssHeight: number,
    scale: number,
    gen: number,
    dpr: number,
  ): void {
    const token = ++state.token;
    state.renderedWidth = cssWidth;
    state.renderedHeight = cssHeight;
    // Backing store: dpr-scaled, capped so extreme zooms cannot explode.
    let bw = Math.round(cssWidth * dpr);
    let bh = Math.round(cssHeight * dpr);
    const pixels = bw * bh;
    if (pixels > MAX_BACKING_PIXELS) {
      const shrink = Math.sqrt(MAX_BACKING_PIXELS / pixels);
      bw = Math.round(bw * shrink);
      bh = Math.round(bh * shrink);
    }
    state.canvas.width = bw;
    state.canvas.height = bh;

    void this.renderer
      .render(page, state.canvas, cssWidth, cssHeight, scale, dpr)
      .then(() => {
        if (this.destroyed || gen !== this.generation) return;
        if (state.token === token) state.token = 0; // done; release the slot
      })
      .catch(() => {
        if (this.destroyed) return;
        // A failed render releases the slot; the page stays blank until the
        // next sync retries it (e.g. after a transient worker error).
        if (state.token === token) {
          state.token = 0;
          state.renderedWidth = -1;
          state.renderedHeight = -1;
        }
      });
  }

  /** (Re-)attach the text layer when the page size changed. Failures leave
   *  the page without text (scanned pages have none anyway). */
  private queueText(
    page: number,
    state: RenderState,
    cssWidth: number,
    cssHeight: number,
    scale: number,
  ): void {
    state.textWidth = cssWidth;
    state.textHeight = cssHeight;
    state.text.replaceChildren();
    state.textAttached = false;
    const factory = this.textFactory;
    if (!factory) return;
    void factory
      .attach(page, state.text, cssWidth, cssHeight, scale)
      .then(() => {
        if (this.destroyed || !this.pages.has(page)) return;
        state.textAttached = true;
        this.onTextReady?.(page);
      })
      .catch(() => {
        /* no text on this page — selection/search fall back gracefully */
      });
  }

  /** Drop page boxes outside the wanted window, keeping memory bounded (§14):
   *  evict the farthest-from-window pages first. */
  private evict(wanted: Set<number>): void {
    if (this.pages.size <= MAX_CANVASES) return;
    const notWanted = [...this.pages.keys()].filter((p) => !wanted.has(p));
    // Farthest from the wanted window first (wanted is contiguous).
    const windowCenter = wanted.size > 0 ? [...wanted].reduce((a, b) => a + b, 0) / wanted.size : 1;
    notWanted.sort((a, b) => Math.abs(b - windowCenter) - Math.abs(a - windowCenter));
    for (const page of notWanted) {
      if (this.pages.size <= MAX_CANVASES) break;
      this.dropPage(page);
    }
  }

  private dropPage(page: number): void {
    const state = this.pages.get(page);
    if (!state) return;
    state.token += 1; // invalidate any in-flight render for this page
    this.renderer.release?.(page);
    this.textFactory?.release(page);
    state.wrapper.remove();
    this.pages.delete(page);
  }

  /** The DOM box for one page (decoration painting, hit-testing); null when
   *  the page is not currently materialised. */
  pageBox(page: number): PageBox | null {
    return this.pages.get(page) ?? null;
  }

  /** Force re-render of one page (or all) on the next sync. */
  invalidate(page?: number): void {
    if (page === undefined) {
      for (const state of this.pages.values()) {
        state.renderedWidth = -1;
        state.renderedHeight = -1;
      }
      return;
    }
    const state = this.pages.get(page);
    if (state) {
      state.renderedWidth = -1;
      state.renderedHeight = -1;
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const page of [...this.pages.keys()]) this.dropPage(page);
    this.layer?.remove();
    this.layer = null;
  }
}

/** Real canvas renderer over pdf.js. Keeps one PDFPageProxy per visited
 *  page and releases it on eviction. */
export function pdfjsPageRenderer(doc: PDFDocumentProxy): PageRenderer {
  const pageCache = new Map<number, PDFPageProxy>();
  return {
    async render(page, canvas, _cssWidth, _cssHeight, scale, dpr) {
      const proxy = await loadPage(pageCache, doc, page);
      const viewport = proxy.getViewport({ scale: scale * dpr });
      await proxy.render({
        canvas,
        viewport,
        // White page background: the PDF itself may not paint one, and the
        // theme backdrop must not bleed through the page (plan §7.4).
        background: "#ffffff",
      } as never).promise;
    },
    release(page) {
      const proxy = pageCache.get(page);
      if (proxy) {
        pageCache.delete(page);
        try {
          proxy.cleanup();
        } catch {
          /* already cleaned */
        }
      }
    },
  };
}

async function loadPage(
  cache: Map<number, PDFPageProxy>,
  doc: PDFDocumentProxy,
  page: number,
): Promise<PDFPageProxy> {
  let proxy = cache.get(page);
  if (!proxy) {
    proxy = await doc.getPage(page);
    cache.set(page, proxy);
  }
  return proxy;
}

/** Real text-layer factory over pdf.js TextLayer (§7.4). TextContent is
 *  fetched per page and cached by the caller's session when possible; the
 *  factory re-fetches because it also needs the fresh page proxy. */
export function pdfjsTextFactory(doc: PDFDocumentProxy): PageTextFactory {
  const contentCache = new Map<number, Promise<PDFPageProxy>>();
  return {
    async attach(page, container, _cssWidth, _cssHeight, scale) {
      let paged = contentCache.get(page);
      if (!paged) {
        paged = doc.getPage(page);
        contentCache.set(page, paged);
      }
      const proxy = await paged;
      const content = await proxy.getTextContent();
      const viewport = textLayerViewport(proxy, scale);
      await renderPdfTextLayer(content, container, viewport);
    },
    release(page) {
      contentCache.delete(page);
    },
  };
}
