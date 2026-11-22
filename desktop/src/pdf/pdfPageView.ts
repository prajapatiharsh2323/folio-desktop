// Canvas render queue for PDF pages (PDF plan §7.2/§7.4). Owns one box per
// rendered page — a wrapper containing the canvas, the pdf.js text layer
// (selection/search substrate) and the decoration layer (highlights) — and
// renders only the visible window (plus a small margin), evicts far pages,
// and keeps independent, page-scoped request identities for the canvas and
// the text layer so a stale asynchronous result can never lock a slot or
// commit onto the current page.
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
    rotation?: number,
  ): Promise<void>;
  /** Cancel the in-flight paint for a page when a newer request supersedes it.
   *  Optional so simple test renderers stay valid. */
  cancel?(page: number): void;
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
    rotation?: number,
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
  /** CSS size the canvas was last requested at (-1 = dirty) */
  renderedWidth: number;
  renderedHeight: number;
  /** identity of the in-flight canvas request; 0 = idle */
  renderToken: number;
  /** rotation the canvas was last requested at */
  renderRotation: number;
  /** CSS size the text layer was last attached at (-1 = dirty) */
  textWidth: number;
  textHeight: number;
  /** rotation the text layer was last attached at */
  textRotation: number;
  /** identity of the in-flight text-layer request; 0 = idle */
  textToken: number;
  /** the slot element owned by the in-flight text request */
  textSlot: HTMLElement | null;
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
    const layer = this.host.createElement("div");
    layer.className = "folio-pdf-layer";
    this.container.appendChild(layer);
    this.layer = layer;
  }

  /** Sync page boxes with the layout + visible range. Cheap to call often:
   *  positions are updated every time; renders are queued only for dirty or
   *  missing pages inside the range. */
  sync(layout: PageLayout, visible: [number, number], dpr: number, rotation = 0): void {
    if (this.destroyed) return;
    const [first, last] = visible;
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

      const dirty =
        state.renderedWidth !== p.width ||
        state.renderedHeight !== p.height ||
        state.renderRotation !== rotation;
      if (dirty) {
        this.queueRender(p.page, state, p.width, p.height, layout.scale, effectiveDpr, rotation);
      }
      if (
        this.textFactory &&
        (state.textWidth !== p.width ||
          state.textHeight !== p.height ||
          state.textRotation !== rotation)
      ) {
        this.queueText(p.page, state, p.width, p.height, layout.scale, rotation);
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
      renderToken: 0,
      renderRotation: 0,
      textWidth: -1,
      textHeight: -1,
      textRotation: 0,
      textToken: 0,
      textSlot: null,
    };
  }

  /** Queue a canvas render for one page. Each request gets a page-scoped
   *  identity; the slot is released when that identity settles, regardless
   *  of unrelated syncs. A newer request cancels the older one. */
  private queueRender(
    page: number,
    state: RenderState,
    cssWidth: number,
    cssHeight: number,
    scale: number,
    dpr: number,
    rotation: number,
  ): void {
    // Supersede any in-flight paint before starting another for this page.
    if (state.renderToken !== 0) this.renderer.cancel?.(page);
    const token = ++state.renderToken;
    state.renderedWidth = cssWidth;
    state.renderedHeight = cssHeight;
    state.renderRotation = rotation;
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
      .render(page, state.canvas, cssWidth, cssHeight, scale, dpr, rotation)
      .then(() => {
        // Release THIS request's slot. Generation is irrelevant here: an
        // unrelated scroll sync must never strand a completed render token.
        if (!this.destroyed && state.renderToken === token) state.renderToken = 0;
      })
      .catch(() => {
        if (this.destroyed || state.renderToken !== token) return;
        // A failed render releases the slot and marks the page dirty so the
        // next sync retries it (e.g. after a transient worker error).
        state.renderToken = 0;
        state.renderedWidth = -1;
        state.renderedHeight = -1;
      });
  }

  /** (Re-)attach the text layer when the page size changed. Each request
   *  owns its own slot element and token: an older attach can never commit
   *  spans onto a newer layout, and failures leave the page retryable. */
  private queueText(
    page: number,
    state: RenderState,
    cssWidth: number,
    cssHeight: number,
    scale: number,
    rotation: number,
  ): void {
    if (state.textToken !== 0) this.textFactory?.release(page);
    const token = ++state.textToken;
    state.textWidth = cssWidth;
    state.textHeight = cssHeight;
    state.textRotation = rotation;
    state.textAttached = false;
    const slot = this.host.createElement("div");
    slot.className = "folio-pdf-text-slot";
    state.text.replaceChildren(slot);
    state.textSlot = slot;
    const factory = this.textFactory;
    if (!factory) return;
    void factory
      .attach(page, slot, cssWidth, cssHeight, scale, rotation)
      .then(() => {
        if (this.destroyed || !this.pages.has(page) || state.textToken !== token) {
          slot.remove();
          return;
        }
        state.textAttached = true;
        this.onTextReady?.(page);
      })
      .catch(() => {
        if (this.destroyed || state.textToken !== token) {
          slot.remove();
          return;
        }
        // Allow a retry on the next sync instead of silently keeping a stale
        // size that blocks re-attachment forever.
        state.textToken = 0;
        state.textWidth = -1;
        state.textHeight = -1;
        slot.remove();
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
    // Invalidate both request identities and cancel the in-flight paint.
    state.renderToken += 1;
    state.textToken += 1;
    this.renderer.cancel?.(page);
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
 *  page, releases it on eviction, and cancels superseded render tasks. */
export function pdfjsPageRenderer(doc: PDFDocumentProxy): PageRenderer {
  const pageCache = new Map<number, PDFPageProxy>();
  const tasks = new Map<number, { cancel(): void }>();
  return {
    async render(page, canvas, _cssWidth, _cssHeight, scale, dpr, rotation = 0) {
      const proxy = await loadPage(pageCache, doc, page);
      const viewport = proxy.getViewport({ scale: scale * dpr, rotation });
      const task = proxy.render({
        canvas,
        viewport,
        // White page background: the PDF itself may not paint one, and the
        // theme backdrop must not bleed through the page (plan §7.4).
        background: "#ffffff",
      } as never);
      tasks.set(page, task as unknown as { cancel(): void });
      try {
        await task.promise;
      } finally {
        if (tasks.get(page) === task) tasks.delete(page);
      }
    },
    cancel(page) {
      tasks.get(page)?.cancel();
      tasks.delete(page);
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
    async attach(page, container, _cssWidth, _cssHeight, scale, rotation = 0) {
      let paged = contentCache.get(page);
      if (!paged) {
        paged = doc.getPage(page);
        contentCache.set(page, paged);
      }
      const proxy = await paged;
      const content = await proxy.getTextContent();
      const viewport = textLayerViewport(proxy, scale, rotation);
      await renderPdfTextLayer(content, container, viewport);
    },
    release(page) {
      contentCache.delete(page);
    },
  };
}
