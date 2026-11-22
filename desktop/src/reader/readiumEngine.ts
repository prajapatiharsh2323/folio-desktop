// Readium web toolkit engine adapter (ReaderEngine impl over EpubNavigator).
import {
  DecorationStyleType,
  EpubNavigator,
  EpubPreferences,
  type Decoration,
  type DecorationObserver,
  type EpubNavigatorListeners,
  type OnDecorationActivatedEvent,
} from "@readium/navigator";
import {
  Locator,
  LocatorLocations,
  LocatorText,
  type Link,
  type Publication,
} from "@readium/shared";
import type {
  DecorationSpec,
  EngineOpenProgress,
  HighlightActivation,
  NoterefActivation,
  ReaderClickInfo,
  ReaderEngine,
  ReaderLocator,
  ReaderOpenTarget,
  SearchHit,
  TextSelectionInfo,
  TocEntry,
} from "./ReaderEngine";
import { strFromU8 } from "fflate";
import type { ReadingPrefs } from "../model/types";
import { htmlToText } from "../lib/htmlToText";
import {
  buildCorpus,
  buildSnippetParts,
  findOccurrences,
  anchorFor,
  type TextCorpus,
} from "../search/occurrences";
import { resolveReaderTheme, toNavigatorPreferences } from "./readerThemes";
import {
  openEpubFromBytesAsync,
  type EpubPackage,
  type PositionsCacheHook,
} from "./epubPublication";
import { locatorForProgression, progressionForLocator } from "./positions";
import {
  decodeLocation,
  encodeLocation,
  isCfiLocation,
  MAX_DECORATION_ANCHOR_CHARS,
} from "./locatorCodec";
import {
  createNoterefIntercept,
  extractFootnote,
  resolveNoterefTarget,
  type NoterefIntercept,
} from "./footnotes";
import { handleError } from "../lib/errorLog";

const XHTML = "application/xhtml+xml";
import type { MiniSearch } from "../search/miniSearch";

/** Occurrence caps for per-occurrence search (R2): one hit per match, capped
 *  per chapter and in total so a common word cannot flood the panel. */
const MAX_CHAPTER_OCCURRENCES = 100;
const MAX_TOTAL_OCCURRENCES = 300;

export class ReadiumEngine implements ReaderEngine {
  private navigator: EpubNavigator | null = null;
  private pub: Publication | null = null;
  private opened: EpubPackage | null = null;
  private container: HTMLElement | null = null;
  private frameDpr = 1;
  private positions: Locator[] = [];
  private locatorCbs = new Set<(loc: ReaderLocator) => void>();
  private selectionCbs = new Set<(sel: TextSelectionInfo | null) => void>();
  private linkCbs = new Set<(href: string) => boolean>();
  /** In-content internal links (footnotes, cross-references), routed through the coordinator. */
  private internalLinkCbs = new Set<(locator: string) => boolean>();
  /** Noteref activations for the footnote popover (R4 2.2b). */
  private noterefCbs = new Set<(activation: NoterefActivation | null) => void>();
  /** Highlight decoration activations for the annotation popover (R5). */
  private highlightCbs = new Set<(activation: HighlightActivation) => boolean>();
  /** Registered highlight decoration observer (unregistered on destroy). */
  private decorationObserver: DecorationObserver | null = null;
  /** Capture-phase interception hooks installed per frame document. */
  private noterefHooks = new Set<{
    doc: Document;
    intercept: NoterefIntercept;
  }>();
  private clickCbs = new Set<(info: ReaderClickInfo) => boolean>();
  private contextMenuCbs = new Set<(info: ReaderClickInfo) => boolean>();
  private pointerCbs = new Set<() => void>();
  private frameWindows = new Set<Window>();
  private lastPointerEmit = 0;
  private lastLocator: ReaderLocator | null = null;
  private chapterMarksCache: { href: string; percent: number }[] | null = null;
  private systemDark = false;
  /** Additive "Publisher" presentation: leave author colours in place. */
  private respectPublisherColors = false;
  private searchIndex: MiniSearch | null = null;
  private searchIndexPromise: Promise<MiniSearch | null> | null = null;
  /** per-chapter word-scan structures for occurrence lookup (R2) */
  private searchCorpora = new Map<string, TextCorpus>();
  /** F9 5.2a: `spread: "auto"` must re-resolve when the viewport crosses the
   *  spread width; the navigator's own ResizeObserver only re-flows. */
  private readonly resizeHandler = (): void => {
    if (this.prefs.flow !== "paginated" || this.prefs.spread !== "auto") return;
    void this.applyPrefs(this.prefs);
  };

  constructor(
    private epubBytes: Uint8Array,
    private prefs: ReadingPrefs,
    private initial: ReaderOpenTarget | null = null,
    private positionsCache?: PositionsCacheHook,
  ) {
    if (typeof window !== "undefined") {
      if (typeof window.matchMedia === "function") {
        this.systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }
      // F9 5.2a: `spread: "auto"` re-resolves on viewport changes; the
      // handler no-ops unless prefs are paginated + auto.
      window.addEventListener("resize", this.resizeHandler);
    }
  }

  async open(
    container: HTMLElement,
    onProgress?: (progress: EngineOpenProgress) => void,
  ): Promise<void> {
    const opened = await openEpubFromBytesAsync(this.epubBytes, onProgress, this.positionsCache);
    this.opened = opened;
    this.pub = opened.publication;
    this.positions = opened.positions;
    this.container = container;

    const listeners: EpubNavigatorListeners = {
      frameLoaded: (wnd) => {
        this.frameDpr = wnd.devicePixelRatio || 1;
        // The content frame swallows hover; re-emit it for the chrome.
        this.frameWindows.add(wnd);
        wnd.addEventListener("pointermove", this.framePointerMove, { passive: true });
        // Noteref interception runs in-frame (see footnotes.ts): capture-phase
        // on the frame document beats the toolkit's bubble-phase Peripherals
        // handler, which would otherwise navigate to the footnote anchor.
        this.hookNoteref(wnd);
      },
      positionChanged: (locator) => this.onPositionChanged(locator),
      viewportChanged: () => {},
      timelineItemChanged: () => {},
      tap: () => false,
      click: (e) => this.handleClick(e),
      zoom: () => {},
      miscPointer: () => {},
      scroll: () => {},
      customEvent: () => {},
      handleLocator: (locator) => this.handleLocator(locator),
      textSelected: (selection) => {
        const info = this.selectionFrom(selection);
        this.selectionCbs.forEach((cb) => cb(info));
      },
      contentProtection: () => {},
      // The toolkit blocks the native menu inside the spine frame and reports
      // the event here; ReaderScreen decides what (07 §3) replaces it.
      contextMenu: (e) => this.handleContextMenu(e),
      peripheral: () => {},
    };

    const theme = resolveReaderTheme(this.prefs.theme, this.systemDark);
    const mapped = toNavigatorPreferences(this.prefs, theme, this.respectPublisherColors);
    const initial = this.resolveInitial(this.initial);

    const nav = new EpubNavigator(
      container,
      this.pub,
      listeners,
      this.positions,
      initial ?? undefined,
      {
        preferences: {
          ...mapped,
          fontFamily: mapped.fontFamily ?? undefined,
        },
        defaults: {},
      },
    );
    this.navigator = nav;
    try {
      await nav.load();
    } catch (error) {
      this.navigator = null;
      this.pub = null;
      opened.close();
      this.opened = null;
      throw error;
    }
    // Re-apply after load for engines that initialize layout before preferences.
    await this.applyPrefs(this.prefs);
    // Highlight activation (R5): registering the observer also switches the
    // toolkit's in-frame activation on for the "highlights" group; new frames
    // replay the state on connect.
    this.decorationObserver = {
      onDecorationActivated: (event) => this.handleHighlightActivated(event),
    };
    nav.registerDecorationObserver("highlights", this.decorationObserver);
  }

  async destroy(): Promise<void> {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.resizeHandler);
    }
    for (const wnd of this.frameWindows) {
      try {
        wnd.removeEventListener("pointermove", this.framePointerMove);
      } catch {
        /* frame already gone */
      }
    }
    this.frameWindows.clear();
    this.locatorCbs.clear();
    this.selectionCbs.clear();
    this.linkCbs.clear();
    this.internalLinkCbs.clear();
    this.noterefCbs.clear();
    this.highlightCbs.clear();
    try {
      if (this.decorationObserver) {
        this.navigator?.unregisterDecorationObserver(this.decorationObserver);
      }
    } catch {
      /* navigator already gone */
    }
    this.decorationObserver = null;
    for (const hook of this.noterefHooks) {
      try {
        hook.doc.removeEventListener("pointerup", hook.intercept.onPointerUp, true);
        hook.doc.removeEventListener("click", hook.intercept.onClick, true);
      } catch {
        /* frame already gone */
      }
    }
    this.noterefHooks.clear();
    this.clickCbs.clear();
    this.contextMenuCbs.clear();
    this.pointerCbs.clear();
    this.searchIndex = null;
    this.searchIndexPromise = null;
    this.searchCorpora.clear();
    await this.navigator?.destroy();
    this.opened?.close();
    this.navigator = null;
    this.pub = null;
    this.opened = null;
    this.container = null;
    this.positions = [];
    this.lastLocator = null;
    this.chapterMarksCache = null;
  }

  async applyPrefs(prefs: ReadingPrefs): Promise<void> {
    this.prefs = prefs;
    const theme = resolveReaderTheme(prefs.theme, this.systemDark);
    const mapped = toNavigatorPreferences(prefs, theme, this.respectPublisherColors);
    await this.navigator?.submitPreferences(
      new EpubPreferences({
        backgroundColor: mapped.backgroundColor,
        textColor: mapped.textColor,
        linkColor: mapped.linkColor,
        visitedColor: mapped.visitedColor,
        selectionBackgroundColor: mapped.selectionBackgroundColor,
        selectionTextColor: mapped.selectionTextColor,
        fontFamily: mapped.fontFamily,
        fontSize: mapped.fontSize,
        lineHeight: mapped.lineHeight,
        pageGutter: mapped.pageGutter,
        hyphens: mapped.hyphens,
        textAlign: mapped.textAlign,
        letterSpacing: mapped.letterSpacing,
        paragraphSpacing: mapped.paragraphSpacing,
        scroll: mapped.scroll,
        columnCount: mapped.columnCount ?? null,
      }),
    );
  }

  /** Additive reflowable presentation (no schema-1 field changes). */
  async applyEpubPrefs(prefs: { respectPublisherColors: boolean }): Promise<void> {
    if (this.respectPublisherColors === prefs.respectPublisherColors) return;
    this.respectPublisherColors = prefs.respectPublisherColors;
    await this.applyPrefs(this.prefs);
  }

  /** OS dark-mode flag changed (R9): "system" themes resolve differently, so
   *  re-submit the current prefs to repaint the canvas. When the navigator
   *  is not mounted yet the flag is simply recorded for open(). */
  async setSystemDark(dark: boolean): Promise<void> {
    if (this.systemDark === dark) return;
    this.systemDark = dark;
    await this.applyPrefs(this.prefs);
  }

  async go(locator: string | { percent: number }, animated = true): Promise<boolean> {
    const nav = this.navigator;
    if (!nav) return false;

    let target: Locator | null = null;
    if (typeof locator === "string") {
      if (!locator || isCfiLocation(locator)) return false;
      target = this.locatorFromString(locator);
    } else {
      target = locatorForProgression(locator.percent / 100, this.positions);
    }
    if (!target) return false;
    return new Promise<boolean>((resolve) => {
      nav.go(target as Locator, animated, (ok) => resolve(ok));
    });
  }

  async goForward(): Promise<boolean> {
    const nav = this.navigator;
    if (!nav) return false;
    return new Promise<boolean>((resolve) => nav.goForward(false, (ok) => resolve(ok)));
  }

  async goBackward(): Promise<boolean> {
    const nav = this.navigator;
    if (!nav) return false;
    return new Promise<boolean>((resolve) => nav.goBackward(false, (ok) => resolve(ok)));
  }

  async goAnchored(quote: string, prefix: string, suffix: string): Promise<boolean> {
    const nav = this.navigator;
    if (!nav) return false;
    const base = this.currentBaseLocator();
    if (!base) return false;
    const loc = new Locator({
      href: base.href,
      type: base.type,
      title: base.title,
      locations: base.locations,
      text: new LocatorText({ highlight: quote, before: prefix, after: suffix }),
    });
    return new Promise<boolean>((resolve) => {
      nav.go(loc, true, (ok) => resolve(ok));
    });
  }

  currentLocator(): ReaderLocator | null {
    return this.lastLocator;
  }

  totalProgression(): number | null {
    return this.lastLocator?.progression ?? null;
  }

  /** Start percent of each spine resource (R11), cached over the positions
   *  list: the first position of a resource carries its start progression. */
  chapterMarks(): { href: string; percent: number }[] {
    if (this.chapterMarksCache) return this.chapterMarksCache;
    if (this.positions.length === 0) return [];
    const marks: { href: string; percent: number }[] = [];
    const seen = new Set<string>();
    for (const loc of this.positions) {
      const href = loc.href;
      if (seen.has(href)) continue;
      seen.add(href);
      marks.push({
        href,
        percent: Math.round((loc.locations?.totalProgression ?? 0) * 1000) / 10,
      });
    }
    this.chapterMarksCache = marks;
    return marks;
  }

  async applyDecorations(decorations: DecorationSpec[], group = "highlights"): Promise<void> {
    const nav = this.navigator;
    if (!nav) return;
    // A decoration whose locator cannot be resolved is skipped rather than
    // painted at the chapter start — a highlight in the wrong place is worse
    // than a missing one. Report skips so a bad locator is diagnosable.
    const locators: Decoration[] = [];
    let skipped = 0;
    for (const d of decorations) {
      // Decoration locators carry the full selected quote; the default 200-char
      // progress cap would truncate it and paint only the first visual line.
      const locator = this.locatorFromString(d.locator, MAX_DECORATION_ANCHOR_CHARS);
      if (!locator) {
        skipped += 1;
        continue;
      }
      locators.push(toReadiumDecoration(d, locator));
    }
    if (skipped > 0) {
      handleError(`Skipped ${skipped} decoration(s) with unresolvable locators`, {
        context: "reader.decorations.locate",
      });
    }
    nav.applyDecorations(locators, group);
  }

  private async getSearchIndex(): Promise<MiniSearch | null> {
    const pub = this.pub;
    if (!pub) return null;
    if (this.searchIndex) return this.searchIndex;
    if (this.searchIndexPromise) return this.searchIndexPromise;

    this.searchIndexPromise = (async () => {
      const { MiniSearch } = await import("../search/miniSearch");
      const idx = new MiniSearch();
      const bookTitle = typeof pub.metadata?.title === "string" ? pub.metadata.title : undefined;
      for (const link of pub.readingOrder.items) {
        let text = "";
        try {
          const bytes = await pub.get(link).read();
          if (bytes) text = htmlToText(strFromU8(bytes));
        } catch {
          text = "";
        }
        idx.add({
          id: link.href,
          title: link.title ?? link.href,
          docTitle: bookTitle,
          text,
          href: link.href,
          chapterTitle: link.title ?? link.href,
        });
        this.searchCorpora.set(link.href, buildCorpus(text));
      }
      this.searchIndex = idx;
      return idx;
    })().catch((error: unknown) => {
      // A transient failure (bad zip entry, allocation error) must not poison
      // every later search for the life of this book: drop the cached
      // rejection so the next query retries the build.
      this.searchIndexPromise = null;
      throw error;
    });

    return this.searchIndexPromise;
  }

  async search(query: string): Promise<SearchHit[]> {
    // R2: two characters minimum, one result per occurrence.
    if (query.trim().length < 2 || !this.pub) return [];
    const idx = await this.getSearchIndex();
    if (!idx || !this.pub) return [];
    const matches = idx.search(query, 50);

    const hits: SearchHit[] = [];
    let budget = MAX_TOTAL_OCCURRENCES;
    for (const m of matches) {
      if (budget <= 0) break;
      const corpus = this.searchCorpora.get(m.href ?? m.id);
      if (!corpus) continue;
      const spans = findOccurrences(corpus, query, { limit: MAX_CHAPTER_OCCURRENCES });
      for (const span of spans) {
        if (budget <= 0) break;
        budget -= 1;
        hits.push({
          chapterTitle: m.chapterTitle ?? "",
          snippet: buildSnippetParts(corpus.raw, [span]),
          locator: m.href ?? m.id,
          anchor: anchorFor(corpus.raw, span),
        });
      }
    }
    return hits;
  }

  toc(): TocEntry[] {
    const items = this.pub?.toc?.items ?? [];
    const out: TocEntry[] = [];
    const walk = (links: Link[], depth: number) => {
      for (const link of links) {
        out.push({ title: link.title ?? link.href, href: link.href, depth });
        if (link.children) walk(link.children.items, depth + 1);
      }
    };
    walk(items, 0);
    return out;
  }

  onSelection(cb: (sel: TextSelectionInfo | null) => void): () => void {
    this.selectionCbs.add(cb);
    return () => this.selectionCbs.delete(cb);
  }

  onLocator(cb: (loc: ReaderLocator) => void): () => void {
    this.locatorCbs.add(cb);
    return () => this.locatorCbs.delete(cb);
  }

  onLink(cb: (href: string) => boolean): () => void {
    this.linkCbs.add(cb);
    return () => this.linkCbs.delete(cb);
  }

  /**
   * Subscribe to in-content internal link activations. The handler receives
   * the link's locator as a resumable location string and returns true when it
   * routed the move (through the navigation coordinator). Without any handler,
   * internal links fall back to the navigator's own move (old behaviour).
   */
  onInternalLink(cb: (locator: string) => boolean): () => void {
    this.internalLinkCbs.add(cb);
    return () => this.internalLinkCbs.delete(cb);
  }

  onNoteref(cb: (activation: NoterefActivation | null) => void): () => void {
    this.noterefCbs.add(cb);
    return () => this.noterefCbs.delete(cb);
  }

  onHighlightActivated(cb: (activation: HighlightActivation) => boolean): () => void {
    this.highlightCbs.add(cb);
    return () => this.highlightCbs.delete(cb);
  }

  /**
   * A highlight was clicked in a frame (R5). Comms coordinates are frame CSS
   * px scaled by the device pixel ratio; resolve the frame by hit-test so a
   * two-up spread still reports host-relative coordinates.
   */
  private handleHighlightActivated(event: OnDecorationActivatedEvent): boolean {
    const id = event.decoration?.id;
    if (!id) return false;
    const point = this.hostPointFromFrame(event.point, event.rect);
    let consumed = false;
    for (const cb of this.highlightCbs) {
      if (
        cb({
          id,
          group: event.group ?? "highlights",
          x: point.x,
          y: point.y,
        })
      ) {
        consumed = true;
      }
    }
    return consumed;
  }

  /** Frame CSS px (already unscaled) → host-relative CSS px. */
  private hostPointFromFrame(
    point?: { x: number; y: number },
    rect?: { top: number; left: number; width: number; height: number },
  ): { x: number; y: number } {
    const dpr = this.frameDpr || 1;
    let fx: number;
    let fy: number;
    if (point && (point.x || point.y)) {
      fx = point.x / dpr;
      fy = point.y / dpr;
    } else if (rect) {
      fx = (rect.left + rect.width / 2) / dpr;
      fy = (rect.top + rect.height / 2) / dpr;
    } else {
      fx = 0;
      fy = 0;
    }
    const cr = this.container?.getBoundingClientRect();
    for (const wnd of this.frameWindows) {
      const fr = wnd.frameElement?.getBoundingClientRect();
      if (!fr) continue;
      if (fx >= 0 && fx <= fr.width && fy >= 0 && fy <= fr.height) {
        return { x: fx + (fr.left - (cr?.left ?? 0)), y: fy + (fr.top - (cr?.top ?? 0)) };
      }
    }
    // No containing frame (or none mounted): first frame offset as fallback.
    const fr = this.frameWindows.values().next().value?.frameElement?.getBoundingClientRect();
    return {
      x: fx + (fr?.left ?? 0) - (cr?.left ?? 0),
      y: fy + (fr?.top ?? 0) - (cr?.top ?? 0),
    };
  }

  /**
   * Install the noteref interception pair on a frame document. Guarded by a
   * marker so a reloaded frame document cannot be hooked twice.
   */
  private hookNoteref(wnd: Window): void {
    const doc = wnd.document;
    if (!doc) return;
    // Evicted pool frames leave dead documents behind; drop their hooks.
    for (const hook of this.noterefHooks) {
      if (!hook.doc.defaultView) this.noterefHooks.delete(hook);
      else if (hook.doc === doc) return; // already hooked
    }
    const intercept = createNoterefIntercept({
      hasSelection: () => Boolean(wnd.getSelection()?.toString()),
      onActivate: (anchor, ev) => this.handleNoterefActivation(anchor, ev, wnd),
    });
    doc.addEventListener("pointerup", intercept.onPointerUp, true);
    doc.addEventListener("click", intercept.onClick, true);
    this.noterefHooks.add({ doc, intercept });
  }

  /**
   * A noteref was activated in a frame: resolve its target against the open
   * chapter, pull the footnote body from the zip, sanitize it, and hand the
   * activation to the host. Never navigates.
   */
  private handleNoterefActivation(
    anchor: HTMLAnchorElement,
    ev: PointerEvent | MouseEvent,
    wnd: Window,
  ): void {
    if (!this.opened || !this.pub) return;
    const chapterHref = this.lastLocator?.chapterHref;
    const linkHref = anchor.getAttribute("href") ?? "";
    const target = chapterHref ? resolveNoterefTarget(chapterHref, linkHref) : null;
    if (!target) {
      handleError(new Error(`Unresolvable noteref href: ${linkHref || "(empty)"}`), {
        context: "reader.noteref",
      });
      this.noterefCbs.forEach((cb) => cb(null));
      return;
    }
    const point = this.noterefPoint(anchor, ev, wnd);
    void extractFootnote(this.opened.zip, target)
      .then((body) => {
        if (!body) {
          handleError(new Error(`Footnote body not found: ${target}`), {
            context: "reader.noteref",
          });
          this.noterefCbs.forEach((cb) => cb(null));
          return;
        }
        const activation: NoterefActivation = {
          x: point.x,
          y: point.y,
          html: body.html,
          text: body.text,
          source: target,
        };
        this.noterefCbs.forEach((cb) => cb(activation));
      })
      .catch((error) => {
        handleError(error, { context: "reader.noteref" });
        this.noterefCbs.forEach((cb) => cb(null));
      });
  }

  /** Host-relative CSS px for the popover, from the click (or the anchor). */
  private noterefPoint(
    anchor: Element,
    ev: { clientX?: number; clientY?: number },
    wnd: Window,
  ): { x: number; y: number } {
    let cx = ev.clientX ?? 0;
    let cy = ev.clientY ?? 0;
    if (!cx && !cy) {
      const rect = anchor.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
    }
    // Frame viewport coords → host container coords (frames are 1:1, same-origin).
    const frame = wnd.frameElement?.getBoundingClientRect();
    const cr = this.container?.getBoundingClientRect();
    return {
      x: cx + (frame?.left ?? 0) - (cr?.left ?? 0),
      y: cy + (frame?.top ?? 0) - (cr?.top ?? 0),
    };
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

  /** Readium does not forward hover out of the content frame, so listen on
   *  every loaded frame window. Throttled: the chrome only needs to know the
   *  pointer is moving, not each pixel. */
  private readonly framePointerMove = () => {
    const now = Date.now();
    if (now - this.lastPointerEmit < 100) return;
    this.lastPointerEmit = now;
    this.pointerCbs.forEach((cb) => cb());
  };

  private onPositionChanged(locator: Locator): void {
    const nav = this.navigator;
    let title: string | undefined;
    try {
      title = nav?.timeline.locate(locator)?.title;
    } catch {
      title = undefined;
    }
    const read: ReaderLocator = {
      location: this.locatorToString(locator),
      progression: progressionForLocator(locator, this.positions) ?? undefined,
      chapterTitle: title,
      chapterHref: locator.href,
    };
    this.lastLocator = read;
    this.locatorCbs.forEach((cb) => cb(read));
  }

  private handleLocator(locator: Locator): boolean {
    const href = locator.href;
    if (/^https?:\/\//i.test(href)) {
      for (const cb of this.linkCbs) if (cb(href)) return true;
      return false;
    }
    // Internal links (footnotes, cross-references) are routed through the
    // navigation coordinator so they land in the position history; the
    // navigator's own move stays as a fallback when no handler is registered.
    const asString = this.internalLinkLocatorString(locator);
    if (asString) {
      for (const cb of this.internalLinkCbs) {
        if (cb(asString)) return true;
      }
    }
    this.navigator?.go(locator, true, () => {});
    return true;
  }

  /** Internal link locator as a resumable location string (null = unroutable). */
  private internalLinkLocatorString(locator: Locator): string | null {
    if (locator.href.split("#")[0]) return this.locatorToString(locator);
    // Same-document anchor: resolve against the chapter currently open.
    const base = this.currentBaseLocator();
    if (!base) return null;
    return this.locatorToString(
      new Locator({
        href: base.href,
        type: base.type,
        title: base.title,
        locations: locator.locations,
        text: locator.text,
      }),
    );
  }

  private handleContextMenu(e: {
    x?: number;
    y?: number;
    clientX?: number;
    clientY?: number;
    defaultPrevented?: boolean;
  }): boolean {
    const dpr = this.frameDpr || 1;
    const info: ReaderClickInfo = {
      x: (e.x ?? e.clientX ?? 0) / dpr,
      y: (e.y ?? e.clientY ?? 0) / dpr,
      width: this.container?.clientWidth ?? 0,
      height: this.container?.clientHeight ?? 0,
      // The blocked menu event carries no interactive-element info.
      interactive: false,
      defaultPrevented: Boolean(e.defaultPrevented),
    };
    let consumed = false;
    for (const cb of this.contextMenuCbs) if (cb(info)) consumed = true;
    return consumed;
  }

  private handleClick(e: {
    x: number;
    y: number;
    defaultPrevented: boolean;
    interactiveElement?: string;
    onContent?: boolean;
  }): boolean {
    const info: ReaderClickInfo = {
      x: e.x / (this.frameDpr || 1),
      y: e.y / (this.frameDpr || 1),
      width: this.container?.clientWidth ?? 0,
      height: this.container?.clientHeight ?? 0,
      interactive: Boolean(e.interactiveElement),
      defaultPrevented: e.defaultPrevented,
    };
    for (const cb of this.clickCbs) if (cb(info)) return true;
    return false;
  }

  private resolveInitial(target: ReaderOpenTarget | null): Locator | null {
    if (!target) return null;
    if (target.location && !isCfiLocation(target.location)) {
      const loc = this.locatorFromString(target.location);
      if (loc) return loc;
    }
    if (typeof target.percent === "number") {
      return locatorForProgression(target.percent / 100, this.positions);
    }
    return null;
  }

  /**
   * Rebuild a Locator from a persisted string. The navigator's `loadLocator`
   * tries the text anchor first (`go_text`), then the element id, then the
   * in-resource progression, which is exactly the fallback order we want.
   */
  private locatorFromString(value: string, maxAnchorChars?: number): Locator | null {
    const decoded = decodeLocation(value, maxAnchorChars);
    if (!decoded) return null;
    const { href } = decoded;
    const link = this.pub?.readingOrder.items.find(
      (l) => l.href === href || decodeHref(l.href) === href,
    );
    const base =
      this.positions.find((p) => p.href === href || decodeHref(p.href) === href) ??
      (link
        ? new Locator({
            href: link.href,
            type: link.type ?? XHTML,
            locations: new LocatorLocations({ progression: 0 }),
          })
        : null);
    if (!base) return null;

    const progression = decoded.progression ?? base.locations.progression;
    const locations = new LocatorLocations({
      position: base.locations.position,
      totalProgression: base.locations.totalProgression,
      progression,
      fragments: decoded.fragment ? [decoded.fragment] : undefined,
    });
    const text = decoded.anchor?.quote
      ? new LocatorText({
          highlight: decoded.anchor.quote,
          before: decoded.anchor.prefix ?? "",
          after: decoded.anchor.suffix ?? "",
        })
      : undefined;
    return new Locator({
      href: base.href,
      type: base.type,
      title: base.title,
      locations,
      text,
    });
  }

  private currentBaseLocator(): Locator | null {
    if (!this.lastLocator) return null;
    return this.locatorFromString(this.lastLocator.location);
  }

  /** Persist href + in-resource progression + text anchor (see locatorCodec). */
  private locatorToString(locator: Locator): string {
    const fragments = locator.locations.fragments ?? [];
    const fragment = fragments.find((f) => !/^epubcfi\(/i.test(f));
    const highlight = locator.text?.highlight?.trim();
    return encodeLocation({
      href: locator.href.split("#")[0],
      fragment,
      progression: locator.locations.progression,
      anchor: highlight
        ? {
            quote: highlight,
            prefix: locator.text?.before ?? "",
            suffix: locator.text?.after ?? "",
          }
        : undefined,
    });
  }

  private extractContext(
    targetFrameSrc: string,
    quote: string,
  ): { prefix: string; suffix: string } {
    const empty = { prefix: "", suffix: "" };
    if (!quote) return empty;
    try {
      const frames = Array.from(document.querySelectorAll("iframe"));
      // Prefer the frame the toolkit named, but tolerate blob URL / encoding
      // differences; as a last resort find the frame whose live selection
      // still matches the quote (multi-frame / repeated-src layouts).
      const wanted = targetFrameSrc ? decodeHref(targetFrameSrc) : "";
      const bySrc = frames.find(
        (f) => f.src === targetFrameSrc || (wanted && decodeHref(f.src) === wanted),
      );
      const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
      const candidates = bySrc ? [bySrc, ...frames.filter((f) => f !== bySrc)] : frames;
      const frame = candidates.find((f) => {
        const sel = f.contentDocument?.getSelection?.();
        return !!sel && !sel.isCollapsed && normalize(sel.toString()) === normalize(quote);
      });
      const doc = frame?.contentDocument;
      const selection = doc?.getSelection();
      if (!doc || !selection || selection.isCollapsed || selection.rangeCount === 0) return empty;

      const context = selectionContext(doc, selection.getRangeAt(0), quote);
      if (normalize(selection.toString()) !== normalize(quote)) return empty;
      return context;
    } catch {
      return empty;
    }
  }
  private selectionFrom(sel: {
    text?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    targetFrameSrc?: string;
    locator?: Locator;
  }): TextSelectionInfo | null {
    const text = sel.text?.trim() ?? "";
    if (!text) return null;
    const dpr = this.frameDpr || 1;
    const x = (sel.x ?? 0) / dpr;
    const y = (sel.y ?? 0) / dpr;
    const width = (sel.width ?? 0) / dpr;
    const height = (sel.height ?? 0) / dpr;
    const { prefix, suffix } = this.extractContext(sel.targetFrameSrc ?? "", text);
    return {
      quote: text,
      prefix,
      suffix,
      location: sel.locator ? this.locatorToString(sel.locator) : "",
      chapterId: null,
      rect: { top: y, left: x, bottom: y + height, right: x + width },
    };
  }
}

/**
 * Extract ≤32-char prefix/suffix around a DOM selection range inside one
 * frame (pure, exported for tests). Anchoring the ranges at the common
 * ancestor keeps context aligned when a selection spans several elements —
 * the old `container.textContent` + index approach drifted for repeated
 * phrases and multi-paragraph selections.
 */
export function selectionContext(
  doc: Document,
  range: Range,
  quote: string,
  width = 32,
): { prefix: string; suffix: string } {
  const empty = { prefix: "", suffix: "" };
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  if (quote && normalize(range.toString()) !== normalize(quote)) return empty;
  try {
    const container = range.commonAncestorContainer;
    let scope: Element | null =
      container.nodeType === Node.ELEMENT_NODE
        ? (container as Element)
        : (container.parentElement ?? null);
    // The nearest parent of a text node can be a short <em>/<span> with no
    // surrounding text. Climb until the scope holds enough context to fill a
    // 32-char side (the toolkit's anchor uses before/after of that length).
    while (scope && scope.parentElement && (scope.textContent?.length ?? 0) < width) {
      scope = scope.parentElement;
    }
    if (!scope) return empty;
    const pre = doc.createRange();
    pre.setStart(scope, 0);
    pre.setEnd(range.startContainer, range.startOffset);
    const post = doc.createRange();
    post.setStart(range.endContainer, range.endOffset);
    post.setEnd(scope, scope.childNodes.length);
    return {
      prefix: pre.toString().slice(-width).replace(/^\s+/, ""),
      suffix: post.toString().slice(0, width).replace(/\s+$/, ""),
    };
  } catch {
    return empty;
  }
}

/**
 * Map one Folio decoration spec onto the installed navigator's `Decoration`
 * contract (pure, exported for tests). The 2.14 navigator expects
 * `style: { type, tint }`; passing a bare string leaves `type`/`tint`
 * undefined so the decorator falls back to default yellow and ignores the
 * palette. `enforceContrast` is disabled because our tints are already
 * contrast-pinned against every reader theme.
 */
export function toReadiumDecoration(spec: DecorationSpec, locator: Locator): Decoration {
  return {
    id: spec.id,
    locator,
    style: {
      type:
        spec.style === "underline" ? DecorationStyleType.Underline : DecorationStyleType.Highlight,
      tint: spec.color,
      enforceContrast: false,
    },
  };
}

/** Percent-decoded href without its fragment, for tolerant href comparison. */
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href.split("#")[0]);
  } catch {
    return href.split("#")[0];
  }
}

export function createReadiumEngine(args: {
  epubBytes: Uint8Array;
  prefs: ReadingPrefs;
  initial?: ReaderOpenTarget | null;
  /** Additive positions cache (Step 3.2); omit to always regenerate. */
  positionsCache?: PositionsCacheHook;
}): ReadiumEngine {
  return new ReadiumEngine(args.epubBytes, args.prefs, args.initial ?? null, args.positionsCache);
}
