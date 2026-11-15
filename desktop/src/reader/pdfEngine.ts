// PDF ReaderEngine implementation (PDF plan §7). Thin glue: document state
// lives in PdfSession, canvas painting in PdfPageView, and everything above
// the seam talks to this class. pdf.js imports stay confined to
// src/pdf/pdfjsAdapter.ts (loaded lazily so engine creation stays sync).
import type {
  DecorationSpec,
  ReaderCapabilities,
  ReaderClickInfo,
  ReaderEngine,
  ReaderLocator,
  ReaderOpenTarget,
  SearchHit,
  TextSelectionInfo,
  TocEntry,
} from "./ReaderEngine";
import type { ReadingPrefs } from "../model/types";
import { resolveReaderTheme } from "./readerThemes";
import { hrefForPage, pageFromHref } from "../pdf/pdfLayout";
import { decodeLocation } from "./locatorCodec";
import { extractContext, quoteOccurrences } from "../pdf/quoteMatch";
import { findPdfSearchHits, type PdfSearchPage } from "../pdf/pdfSearch";
import { noCopyFromPermissions } from "../pdf/permissions";
import type { PdfPageLink } from "../pdf/pdfjsAdapter";

const POINTER_EMIT_INTERVAL_MS = 200;
const SELECTION_EMIT_DEBOUNCE_MS = 120;
/** One arrow-key line step in continuous mode (plan §7.3). */
const SCROLL_STEP_PX = 48;
const MAX_HITS_PER_PAGE = 20;
const MAX_SEARCH_HITS = 200;

interface PageDecoration {
  id: string;
  color: string;
  quote: string;
  /** page-relative rects (CSS px) of the painted highlight, for hit-testing */
  rects: { left: number; top: number; right: number; bottom: number }[];
}

export class PdfEngine implements ReaderEngine {
  capabilities?: ReaderCapabilities;

  private readingBytes: Uint8Array;
  private prefs: ReadingPrefs;
  private initial: ReaderOpenTarget | null;
  private systemDark = false;

  // pdf.js module handles (resolved lazily inside open())
  private opened: { doc: unknown; destroy(): Promise<void> } | null = null;
  private session: import("../pdf/pdfSession").PdfSession | null = null;
  private view: import("../pdf/pdfPageView").PdfPageView | null = null;
  private linkResolver: ((page: number, scale: number) => Promise<PdfPageLink[]>) | null = null;

  private container: HTMLElement | null = null;
  private scrollEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private cleanupDom: (() => void) | null = null;
  private destroyed = false;

  private locatorCbs = new Set<(loc: ReaderLocator) => void>();
  private selectionCbs = new Set<(sel: TextSelectionInfo | null) => void>();
  private clickCbs = new Set<(info: ReaderClickInfo) => boolean>();
  private contextMenuCbs = new Set<(info: ReaderClickInfo) => boolean>();
  private pointerCbs = new Set<() => void>();
  private progressCbs = new Set<(fraction: number) => void>();
  private decorationCbs = new Set<(id: string, at?: { x: number; y: number }) => void>();
  private linkCbs = new Set<(href: string) => boolean>();
  private lastPointerEmit = 0;
  private lastLocator: ReaderLocator | null = null;
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSelectionKey: string | null = null;

  /** Highlights painted on the text layer, grouped per page (§7.4). */
  private decorations = new Map<number, PageDecoration[]>();

  /** Link annotations per page at their fetch scale (§12 hardening): the
   *  adapter resolves pdf.js annotations async, so clicks hit a prefetch. */
  private linkCache = new Map<number, { scale: number; links: PdfPageLink[] }>();
  private linkScale = -1;

  constructor(
    readingBytes: Uint8Array,
    prefs: ReadingPrefs,
    initial: ReaderOpenTarget | null = null,
  ) {
    // pdf.js transfers and detaches the buffer it is handed; the store may
    // still own these bytes for a retry, so always open on a copy.
    this.readingBytes = new Uint8Array(readingBytes);
    this.prefs = prefs;
    this.initial = initial;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this.systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
  }

  async open(container: HTMLElement): Promise<void> {
    if (this.destroyed) return;
    this.container = container;

    const [
      { openPdf, classifyPdfError, pageLinkRects },
      { PdfSession },
      { PdfPageView, pdfjsPageRenderer, pdfjsTextFactory },
    ] = await Promise.all([
      import("../pdf/pdfjsAdapter"),
      import("../pdf/pdfSession"),
      import("../pdf/pdfPageView"),
    ]);

    this.emitProgress(0.05);
    let opened: Awaited<ReturnType<typeof openPdf>> | null = null;
    try {
      opened = await openPdf(this.readingBytes, {
        onProgress: (fraction) => {
          if (fraction !== null) this.emitProgress(fraction * 0.5);
        },
      });
    } catch (error) {
      const classified = classifyPdfError(error);
      if (classified) {
        throw new Error(classified.message, { cause: error });
      }
      throw error;
    }
    this.opened = opened;
    this.linkResolver = (page, scale) => pageLinkRects(opened.doc, page, scale);
    this.emitProgress(0.5);

    const session = await PdfSession.open(opened.doc, this.prefs, (fraction) =>
      this.emitProgress(0.5 + fraction * 0.5),
    );
    this.session = session;
    // D2: honour the document's own no-copy permission (reading never blocked).
    let noCopy = false;
    try {
      const perms = (await opened.doc.getPermissions()) as Set<number> | null;
      noCopy = noCopyFromPermissions(perms);
    } catch {
      /* unreadable permissions ⇒ treat as copyable */
    }
    this.capabilities = {
      format: "fixed",
      typography: false,
      zoom: true,
      flow: true,
      spread: true,
      pageCount: session.pageCount,
      noCopy,
    };

    // ---- DOM scaffold: scroll viewport + content plane + page boxes ----
    const scroll = container.ownerDocument.createElement("div");
    scroll.className = "folio-pdf-scroll";
    const content = container.ownerDocument.createElement("div");
    content.className = "folio-pdf-content";
    scroll.appendChild(content);
    container.appendChild(scroll);
    this.scrollEl = scroll;
    this.contentEl = content;

    const view = new PdfPageView(content, pdfjsPageRenderer(opened.doc), {
      textFactory: pdfjsTextFactory(opened.doc),
      onTextReady: (page) => this.repaintPageDecorations(page),
    });
    this.view = view;

    this.applyPrefs(this.prefs);

    // ---- events ----
    const doc = container.ownerDocument;
    const onScroll = () => this.onScroll();
    const onPointerMove = () => this.emitPointerActivity();
    const onPointerDown = () => this.emitPointerActivity();
    const onClick = (e: MouseEvent) => this.handleClick(e);
    const onContextMenu = (e: MouseEvent) => this.handleContextMenu(e);
    const onSelectionChange = () => this.scheduleSelection();
    const onCopy = (e: ClipboardEvent) => this.handleCopyEvent(e);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    scroll.addEventListener("pointermove", onPointerMove, { passive: true });
    scroll.addEventListener("pointerdown", onPointerDown, { passive: true });
    content.addEventListener("click", onClick);
    content.addEventListener("contextmenu", onContextMenu);
    doc.addEventListener("selectionchange", onSelectionChange);
    doc.addEventListener("copy", onCopy);
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.handleResize()) : null;
    if (ro) ro.observe(scroll);
    this.cleanupDom = () => {
      scroll.removeEventListener("scroll", onScroll);
      scroll.removeEventListener("pointermove", onPointerMove);
      scroll.removeEventListener("pointerdown", onPointerDown);
      content.removeEventListener("click", onClick);
      content.removeEventListener("contextmenu", onContextMenu);
      doc.removeEventListener("selectionchange", onSelectionChange);
      doc.removeEventListener("copy", onCopy);
      if (this.selectionTimer) clearTimeout(this.selectionTimer);
      this.selectionTimer = null;
      ro?.disconnect();
    };

    // ---- layout + resume ----
    session.setViewport({
      width: scroll.clientWidth || 800,
      height: scroll.clientHeight || 1000,
    });
    const targetPage = session.pageFromTarget(this.initial) ?? 1;
    session.goToPage(targetPage);
    this.applyLayout();
    scroll.scrollTop = session.offsetForPage(session.page);
    // Ignore the programmatic scroll's own event: the locator is emitted below.
    this.emitLocator();
    this.emitProgress(1);
  }

  // ---- geometry -----------------------------------------------------------

  private applyLayout(): void {
    const session = this.session;
    const content = this.contentEl;
    if (!session || !content) return;
    const layout = session.currentLayout;
    content.style.width = `${layout.totalWidth}px`;
    content.style.height = `${layout.totalHeight}px`;
    this.view?.sync(
      layout,
      session.visibleRange(this.scrollEl?.scrollTop ?? 0, this.scrollEl?.clientHeight ?? 0),
      this.dpr(),
    );
    this.prefetchLinks();
  }

  /** Resolve link annotations for the visible pages at the current render
   *  scale (async, failures silent — links are best-effort navigation). */
  private prefetchLinks(): void {
    const session = this.session;
    const resolve = this.linkResolver;
    if (!session || !resolve || this.destroyed) return;
    const scale = session.renderScale();
    if (scale <= 0) return;
    if (this.linkScale !== scale) {
      this.linkScale = scale;
      this.linkCache.clear();
    }
    const [first, last] = session.visibleRange(
      this.scrollEl?.scrollTop ?? 0,
      this.scrollEl?.clientHeight ?? 0,
    );
    for (let page = first; page <= last; page++) {
      if (this.linkCache.has(page)) continue;
      const entry = { scale, links: [] as PdfPageLink[] };
      this.linkCache.set(page, entry); // reserve; refetch only on scale change
      void resolve(page, scale)
        .then((links) => {
          if (this.destroyed || entry.scale !== this.linkScale) return;
          entry.links = links;
        })
        .catch(() => {
          this.linkCache.delete(page);
        });
    }
  }

  /** Re-layout (zoom/spread/resize) keeping the reading page anchored. */
  private relayoutAnchored(): void {
    const session = this.session;
    if (!session || !this.scrollEl) return;
    const page = session.page;
    this.applyLayout();
    this.scrollEl.scrollTop = session.offsetForPage(page);
    // The scroll event re-syncs canvases; emit only the page (unchanged) locator.
    this.emitLocator();
  }

  private handleResize(): void {
    const scroll = this.scrollEl;
    if (!scroll || !this.session) return;
    const viewport = {
      width: scroll.clientWidth,
      height: scroll.clientHeight,
    };
    if (viewport.width < 1 || viewport.height < 1) return;
    this.session.setViewport(viewport);
    this.relayoutAnchored();
  }

  private onScroll(): void {
    const session = this.session;
    const scroll = this.scrollEl;
    if (!session || !scroll || this.destroyed) return;
    if (session.syncFromOffset(scroll.scrollTop)) {
      this.emitLocator();
    }
    this.view?.sync(
      session.currentLayout,
      session.visibleRange(scroll.scrollTop, scroll.clientHeight),
      this.dpr(),
    );
    this.prefetchLinks();
  }

  private dpr(): number {
    return typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  }

  // ---- locator emission ----------------------------------------------------

  private emitLocator(): void {
    const session = this.session;
    if (!session) return;
    const loc = session.locator(hrefForPage(session.page));
    this.lastLocator = loc;
    this.locatorCbs.forEach((cb) => cb(loc));
  }

  private emitProgress(fraction: number): void {
    this.progressCbs.forEach((cb) => cb(fraction));
  }

  private emitPointerActivity(): void {
    const now = Date.now();
    if (now - this.lastPointerEmit < POINTER_EMIT_INTERVAL_MS) return;
    this.lastPointerEmit = now;
    this.pointerCbs.forEach((cb) => cb());
  }

  private clickInfo(e: MouseEvent): ReaderClickInfo {
    const container = this.container!;
    const rect = container.getBoundingClientRect();
    const target = e.target as HTMLElement | null;
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      interactive: !!target?.closest("a, button, [role='button']"),
      defaultPrevented: e.defaultPrevented,
    };
  }

  private handleClick(e: MouseEvent): void {
    // Decoration hits take priority (R5 popover hook, §7.4).
    if (this.decorationCbs.size > 0 && this.emitDecorationHit(e)) {
      e.preventDefault();
      return;
    }
    // Link annotations next (§12 hardening): internal GoTo navigates, URIs
    // flow to the onLink subscribers (useReaderEngine gates them to
    // http/https via openExternal).
    if (this.emitLinkHit(e)) {
      e.preventDefault();
      return;
    }
    if (this.clickCbs.size === 0) return;
    const info = this.clickInfo(e);
    for (const cb of this.clickCbs) {
      if (cb(info)) {
        e.preventDefault();
        return;
      }
    }
  }

  /** Hit-test one click against the prefetched link rects; returns true when
   *  a link consumed the click (navigated internally or emitted onLink). */
  private emitLinkHit(e: MouseEvent): boolean {
    const target = e.target as HTMLElement | null;
    const pagebox = target?.closest?.(".folio-pdf-pagebox") as HTMLElement | null;
    if (!pagebox) return false;
    const page = Number(pagebox.dataset.page);
    const entry = this.linkCache.get(page);
    if (!entry || entry.links.length === 0) return false;
    const boxRect = pagebox.getBoundingClientRect();
    const px = e.clientX - boxRect.left;
    const py = e.clientY - boxRect.top;
    for (const link of entry.links) {
      const r = link.rect;
      if (px < r.left || px > r.right || py < r.top || py > r.bottom) continue;
      if (link.page !== null) {
        this.jumpToPage(link.page);
        return true;
      }
      if (link.url !== null) {
        for (const cb of this.linkCbs) {
          if (cb(link.url)) return true;
        }
        // No subscriber accepted the URL — treat as an inert click.
        return false;
      }
    }
    return false;
  }

  private handleContextMenu(e: MouseEvent): void {
    if (this.contextMenuCbs.size === 0) return;
    const info = this.clickInfo(e);
    for (const cb of this.contextMenuCbs) {
      if (cb(info)) {
        e.preventDefault();
        return;
      }
    }
  }

  // ---- selection (§7.4) ------------------------------------------------------

  private scheduleSelection(): void {
    if (this.destroyed) return;
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => {
      this.selectionTimer = null;
      this.evaluateSelection();
    }, SELECTION_EMIT_DEBOUNCE_MS);
  }

  /** Build a TextSelectionInfo from the live DOM selection when it sits on a
   *  PDF text layer; collapse → null (deselect). Quote + context are the
   *  authoritative anchor (like EPUB); location is the "page-N" hint. */
  private evaluateSelection(): void {
    if (this.destroyed || !this.container || this.selectionCbs.size === 0) return;
    const doc = this.container.ownerDocument;
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      this.emitSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const anchor =
      range.startContainer.nodeType === 1
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement;
    const pagebox = anchor?.closest?.(".folio-pdf-pagebox") as HTMLElement | null;
    if (!pagebox) {
      this.emitSelection(null);
      return;
    }
    const rawQuote = sel.toString();
    const quote = rawQuote.replace(/\s+/g, " ").trim();
    if (!quote) {
      this.emitSelection(null);
      return;
    }
    const page = Number(pagebox.dataset.page);
    if (!Number.isFinite(page)) {
      this.emitSelection(null);
      return;
    }

    // Toolbar rect: viewport coords of the selection's bounding box, like
    // the Readium engine's selection info.
    const rects = range.getClientRects();
    let top = Infinity;
    let left = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const r of rects) {
      top = Math.min(top, r.top);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    if (!Number.isFinite(top)) {
      const box = range.getBoundingClientRect();
      top = box.top;
      left = box.left;
      right = box.right;
      bottom = box.bottom;
    }

    // Prefix/suffix come from the page's joined text (32 chars, plan §4).
    void this.session
      ?.pageText(page)
      .then((text) => {
        const context = extractContext(text, quote);
        // Only emit once context is available; a cache miss costs one
        // getTextContent call per selection.
        const info: TextSelectionInfo = {
          quote,
          prefix: context.prefix,
          suffix: context.suffix,
          location: hrefForPage(page),
          chapterId: null,
          rect: { top, left, bottom, right },
        };
        this.emitSelection(info);
      })
      .catch(() => {
        this.emitSelection({
          quote,
          prefix: "",
          suffix: "",
          location: hrefForPage(page),
          chapterId: null,
          rect: { top, left, bottom, right },
        });
      });
  }

  private emitSelection(info: TextSelectionInfo | null): void {
    const key = info ? `${info.location}:${info.quote}:${info.rect.top.toFixed(1)}` : null;
    if (key === this.lastSelectionKey) return;
    this.lastSelectionKey = key;
    this.selectionCbs.forEach((cb) => cb(info));
  }

  /** D2: block native copy of a no-copy document (Copy button and
   *  Share-as-image are gated separately at the UI level). */
  private handleCopyEvent(e: ClipboardEvent): void {
    if (!this.capabilities?.noCopy) return;
    const sel = (e.target as Document | null)?.getSelection?.();
    if (!sel || sel.isCollapsed) return;
    const anchor =
      sel.anchorNode?.nodeType === 1
        ? (sel.anchorNode as HTMLElement)
        : sel.anchorNode?.parentElement;
    if (anchor?.closest?.(".folio-pdf-content")) {
      e.preventDefault();
      e.clipboardData?.setData("text/plain", "");
    }
  }

  // ---- decorations (§7.4, R5) --------------------------------------------------

  async applyDecorations(specs: DecorationSpec[]): Promise<void> {
    this.decorations.clear();
    for (const spec of specs) {
      if (spec.style !== "highlight") continue;
      // Locators arrive as "page-N" possibly with the EPUB-style anchor
      // query (decorationsFor() merges quote/prefix/suffix into it).
      const loc = decodeLocation(spec.locator);
      const page = loc ? pageFromHref(loc.href) : null;
      const quote = loc?.anchor?.quote?.trim();
      if (page === null || !quote) continue;
      const list = this.decorations.get(page) ?? [];
      list.push({ id: spec.id, color: spec.color, quote, rects: [] });
      this.decorations.set(page, list);
    }
    // Repaint every materialised page (pages attach lazily).
    for (const page of this.decorations.keys()) this.repaintPageDecorations(page);
  }

  onDecorationClick(cb: (id: string, at?: { x: number; y: number }) => void): () => void {
    this.decorationCbs.add(cb);
    return () => this.decorationCbs.delete(cb);
  }

  /** Hit-test one click against the painted highlight rects (R5). The callback
   *  receives the click position in engine-container coordinates (the space
   *  ReaderScreen's fixed-position popovers are anchored in). */
  private emitDecorationHit(e: MouseEvent): boolean {
    const target = e.target as HTMLElement | null;
    const pagebox = target?.closest?.(".folio-pdf-pagebox") as HTMLElement | null;
    if (!pagebox) return false;
    const page = Number(pagebox.dataset.page);
    const entries = this.decorations.get(page);
    if (!entries || entries.length === 0) return false;
    const boxRect = pagebox.getBoundingClientRect();
    const px = e.clientX - boxRect.left;
    const py = e.clientY - boxRect.top;
    for (const entry of entries) {
      for (const r of entry.rects) {
        if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
          const containerRect = this.container?.getBoundingClientRect();
          const at = containerRect
            ? { x: e.clientX - containerRect.left, y: e.clientY - containerRect.top }
            : undefined;
          this.decorationCbs.forEach((cb) => cb(entry.id, at));
          return true;
        }
      }
    }
    return false;
  }

  /** Paint one page's highlights by matching each quote against the page's
   *  text-layer spans and turning the DOM ranges into translucent rects. */
  private repaintPageDecorations(page: number): void {
    const view = this.view;
    const box = view?.pageBox(page);
    const entries = this.decorations.get(page);
    if (!box || !entries) return;
    box.decorations.replaceChildren();
    for (const entry of entries) entry.rects = [];
    if (!box.textAttached || entries.length === 0) return;

    const doc = box.decorations.ownerDocument;
    const spans = Array.from(box.text.querySelectorAll("span")) as HTMLElement[];
    if (spans.length === 0) return;
    const spanTexts = spans.map((s) => s.textContent ?? "");
    const decorRect = box.decorations.getBoundingClientRect();

    for (const entry of entries) {
      const matches = quoteOccurrences(spanTexts, entry.quote, MAX_HITS_PER_PAGE);
      for (const match of matches) {
        const startNode = textNodeFor(spans[match.startSpan]);
        const endNode = textNodeFor(spans[match.endSpan]);
        if (!startNode || !endNode) continue;
        const range = doc.createRange();
        try {
          range.setStart(startNode, match.startOffset);
          range.setEnd(endNode, match.endOffset + 1);
        } catch {
          continue; // offsets drifted (text re-attached mid-paint)
        }
        const paint = (rects: DOMRectList | DOMRect[]) => {
          for (const r of Array.from(rects)) {
            if (r.width < 0.5 || r.height < 0.5) continue;
            const left = r.left - decorRect.left;
            const top = r.top - decorRect.top;
            const div = doc.createElement("div");
            div.className = "folio-pdf-highlight";
            div.style.left = `${left}px`;
            div.style.top = `${top}px`;
            div.style.width = `${r.width}px`;
            div.style.height = `${r.height}px`;
            div.style.backgroundColor = entry.color;
            box.decorations.appendChild(div);
            entry.rects.push({
              left,
              top,
              right: left + r.width,
              bottom: top + r.height,
            });
          }
        };
        paint(range.getClientRects());
        range.detach?.();
      }
    }
  }

  // ---- in-book search (§7.6) ---------------------------------------------------

  async search(query: string): Promise<SearchHit[]> {
    const session = this.session;
    if (!session || !query.trim()) return [];
    const pages: PdfSearchPage[] = [];
    for (let p = 1; p <= session.pageCount; p++) {
      let text = "";
      try {
        text = await session.pageText(p);
      } catch {
        /* unreadable page text just yields no hits */
      }
      pages.push({
        page: p,
        text,
        title: session.sectionTitleFor(p) ?? session.pageLabel(p),
      });
    }
    return findPdfSearchHits(pages, query, MAX_SEARCH_HITS).map((hit) => ({
      chapterTitle: hit.chapterTitle,
      snippetHtml: hit.snippetHtml,
      locator: hit.locator,
    }));
  }

  // ---- ReaderEngine seam ----------------------------------------------------

  async go(locator: string | { percent: number }): Promise<boolean> {
    const session = this.session;
    if (!session || !this.scrollEl) return false;
    if (typeof locator === "string") {
      const page = pageFromHref(locator);
      if (page === null) return false;
      return this.jumpToPage(page);
    }
    session.goToProgression(locator.percent / 100);
    return this.jumpToPage(session.page);
  }

  private jumpToPage(page: number): boolean {
    const session = this.session;
    if (!session || !this.scrollEl) return false;
    session.goToPage(page);
    this.scrollEl.scrollTop = session.offsetForPage(session.page);
    this.emitLocator();
    return true;
  }

  async goForward(): Promise<boolean> {
    const session = this.session;
    if (!session || session.page >= session.pageCount) return false;
    return this.jumpToPage(session.page + 1);
  }

  async goBackward(): Promise<boolean> {
    const session = this.session;
    if (!session || session.page <= 1) return false;
    return this.jumpToPage(session.page - 1);
  }

  async scrollStep(direction: 1 | -1): Promise<boolean> {
    const scroll = this.scrollEl;
    if (!scroll) return false;
    const before = scroll.scrollTop;
    scroll.scrollTop = before + direction * SCROLL_STEP_PX;
    return scroll.scrollTop !== before;
  }

  currentLocator(): ReaderLocator | null {
    return this.lastLocator;
  }

  totalProgression(): number | null {
    return this.session ? this.session.progression() : null;
  }

  pageInfo(): { page: number; pageCount: number; label?: string } | null {
    const session = this.session;
    if (!session) return null;
    return {
      page: session.page,
      pageCount: session.pageCount,
      label: session.pageLabel(session.page),
    };
  }

  toc(): TocEntry[] {
    return this.session ? this.session.toc : [];
  }

  onSelection(cb: (sel: TextSelectionInfo | null) => void): () => void {
    this.selectionCbs.add(cb);
    return () => this.selectionCbs.delete(cb);
  }

  clearSelection(): void {
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  }

  onLink(cb: (href: string) => boolean): () => void {
    // External URI links flow here (§12 hardening); internal GoTo links
    // navigate directly and never emit.
    this.linkCbs.add(cb);
    return () => this.linkCbs.delete(cb);
  }

  onClick(cb: (info: ReaderClickInfo) => boolean): () => void {
    this.clickCbs.add(cb);
    return () => this.clickCbs.delete(cb);
  }

  onContextMenu(cb: (info: ReaderClickInfo) => boolean): () => void {
    this.contextMenuCbs.add(cb);
    return () => this.contextMenuCbs.delete(cb);
  }

  onPointerActivity(cb: () => void): () => void {
    this.pointerCbs.add(cb);
    return () => this.pointerCbs.delete(cb);
  }

  onLocator(cb: (loc: ReaderLocator) => void): () => void {
    this.locatorCbs.add(cb);
    return () => this.locatorCbs.delete(cb);
  }

  onProgress(cb: (fraction: number) => void): () => void {
    this.progressCbs.add(cb);
    return () => this.progressCbs.delete(cb);
  }

  // ---- zoom ------------------------------------------------------------------

  async setZoom(zoom: "fit-width" | "fit-page" | number): Promise<void> {
    if (!this.session) return;
    this.session.setZoom(zoom);
    this.relayoutAnchored();
  }

  async zoomBy(direction: 1 | -1): Promise<void> {
    if (!this.session) return;
    this.session.zoomBy(direction);
    this.relayoutAnchored();
  }

  getZoom(): "fit-width" | "fit-page" | number | null {
    return this.session?.zoom ?? null;
  }

  // ---- preferences -------------------------------------------------------------

  async applyPrefs(prefs: ReadingPrefs): Promise<void> {
    this.prefs = prefs;
    const container = this.container;
    if (!container) return;
    const theme = resolveReaderTheme(prefs.theme, this.systemDark);
    // The canvas layer carries the page colour; pages stay white on it
    // (plan §7.4 — the paper is the PDF's, the surround is the theme's).
    container.classList.toggle("folio-pdf", true);
    container.classList.toggle("folio-pdf--paginated", prefs.flow === "paginated");
    container.style.setProperty("--pdf-page-bg", theme.pageBg);
    container.style.setProperty("--pdf-page-text", theme.pageText);

    const session = this.session;
    if (!session) return;
    let relayout = false;
    if (session.spreadPref !== prefs.spread) {
      session.setSpreadPref(prefs.spread);
      relayout = true;
    }
    if (relayout) this.relayoutAnchored();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cleanupDom?.();
    this.cleanupDom = null;
    this.view?.destroy();
    this.view = null;
    this.scrollEl?.remove();
    this.scrollEl = null;
    this.contentEl = null;
    this.container = null;
    this.session = null;
    this.decorations.clear();
    this.locatorCbs.clear();
    this.selectionCbs.clear();
    this.clickCbs.clear();
    this.contextMenuCbs.clear();
    this.pointerCbs.clear();
    this.progressCbs.clear();
    this.decorationCbs.clear();
    this.linkCbs.clear();
    this.linkCache.clear();
    this.linkResolver = null;
    const opened = this.opened;
    this.opened = null;
    await opened?.destroy();
  }
}

/** The text node inside a text-layer span (Range offsets are char offsets on
 *  text nodes; pdf.js spans own exactly one text node). */
function textNodeFor(span: HTMLElement): Text | null {
  const first = span.firstChild;
  return first && first.nodeType === 3 ? (first as Text) : null;
}
