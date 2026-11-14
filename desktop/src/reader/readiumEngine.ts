// Readium web toolkit engine adapter (ReaderEngine impl over EpubNavigator).
import { EpubNavigator, EpubPreferences, type EpubNavigatorListeners } from "@readium/navigator";
import {
  Locator,
  LocatorLocations,
  LocatorText,
  type Link,
  type Publication,
} from "@readium/shared";
import type {
  DecorationSpec,
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
  buildSnippet,
  findOccurrences,
  anchorFor,
  type TextCorpus,
} from "../search/occurrences";
import { escapeHtml } from "../search/htmlEscape";
import { resolveReaderTheme, toNavigatorPreferences } from "./readerThemes";
import { openEpubFromBytes, type EpubPackage } from "./epubPublication";
import { locatorForProgression, progressionForLocator } from "./positions";
import { decodeLocation, encodeLocation, isCfiLocation } from "./locatorCodec";
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
  private systemDark = false;
  private searchIndex: MiniSearch | null = null;
  private searchIndexPromise: Promise<MiniSearch | null> | null = null;
  /** per-chapter word-scan structures for occurrence lookup (R2) */
  private searchCorpora = new Map<string, TextCorpus>();

  constructor(
    private epubBytes: Uint8Array,
    private prefs: ReadingPrefs,
    private initial: ReaderOpenTarget | null = null,
  ) {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this.systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
  }

  async open(container: HTMLElement): Promise<void> {
    const opened = openEpubFromBytes(this.epubBytes);
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
    const mapped = toNavigatorPreferences(this.prefs, theme);
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
  }

  async destroy(): Promise<void> {
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
  }

  async applyPrefs(prefs: ReadingPrefs): Promise<void> {
    this.prefs = prefs;
    const theme = resolveReaderTheme(prefs.theme, this.systemDark);
    const mapped = toNavigatorPreferences(prefs, theme);
    await this.navigator?.submitPreferences(
      new EpubPreferences({
        backgroundColor: mapped.backgroundColor,
        textColor: mapped.textColor,
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

  async applyDecorations(decorations: DecorationSpec[], group = "highlights"): Promise<void> {
    const nav = this.navigator;
    if (!nav) return;
    // A decoration whose locator cannot be resolved is skipped rather than
    // painted at the chapter start — a highlight in the wrong place is worse
    // than a missing one.
    const locators = decorations
      .map((d) => {
        const locator = this.locatorFromString(d.locator);
        if (!locator) return null;
        return { id: d.id, locator, style: d.style, color: d.color };
      })
      .filter(
        (d): d is { id: string; locator: Locator; style: string; color: string } => d !== null,
      );
    nav.applyDecorations(locators as never, group);
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
          snippetHtml: buildSnippet(corpus.raw, [span], escapeHtml),
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
  private locatorFromString(value: string): Locator | null {
    const decoded = decodeLocation(value);
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
    try {
      const frame = Array.from(document.querySelectorAll("iframe")).find(
        (f) => f.src === targetFrameSrc,
      );
      const doc = frame?.contentDocument;
      const selection = doc?.getSelection();
      if (!doc || !selection || selection.rangeCount === 0) {
        return { prefix: "", suffix: "" };
      }
      const range = selection.getRangeAt(0);
      const container =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentNode
          : range.commonAncestorContainer;
      if (!container) return { prefix: "", suffix: "" };
      const text = container.textContent ?? "";

      const preRange = doc.createRange();
      preRange.setStart(container, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      const prefix = preRange.toString().slice(-32);

      const sufRange = doc.createRange();
      sufRange.setStart(range.endContainer, range.endOffset);
      sufRange.setEnd(container, container.childNodes.length);
      const suffix = sufRange.toString().slice(0, 32);

      // Guard against a mismatched quote (DOM moved) — better empty than wrong.
      if (quote && !text.includes(quote)) return { prefix: "", suffix: "" };
      return { prefix, suffix };
    } catch {
      return { prefix: "", suffix: "" };
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
}): ReadiumEngine {
  return new ReadiumEngine(args.epubBytes, args.prefs, args.initial ?? null);
}
