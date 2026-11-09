// Readium web toolkit engine adapter (ReaderEngine impl over EpubNavigator).
import {
  EpubNavigator,
  EpubPreferences,
  type EpubNavigatorListeners,
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
import { resolveReaderTheme, toNavigatorPreferences } from "./readerThemes";
import { openEpubFromBytes, type EpubPackage } from "./epubPublication";
import {
  locatorForProgression,
  progressionForLocator,
} from "./positions";
import {
  decodeLocation,
  encodeLocation,
  isCfiLocation,
} from "./locatorCodec";

const XHTML = "application/xhtml+xml";
import type { MiniSearch } from "../search/miniSearch";

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
  private clickCbs = new Set<(info: ReaderClickInfo) => boolean>();
  private contextMenuCbs = new Set<(info: ReaderClickInfo) => boolean>();
  private pointerCbs = new Set<() => void>();
  private frameWindows = new Set<Window>();
  private lastPointerEmit = 0;
  private lastLocator: ReaderLocator | null = null;
  private systemDark = false;
  private searchIndex: MiniSearch | null = null;
  private searchIndexPromise: Promise<MiniSearch | null> | null = null;

  constructor(
    private epubBytes: Uint8Array,
    private prefs: ReadingPrefs,
    private initial: ReaderOpenTarget | null = null
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
      }
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
    this.clickCbs.clear();
    this.contextMenuCbs.clear();
    this.pointerCbs.clear();
    this.searchIndex = null;
    this.searchIndexPromise = null;
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
      })
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

  async applyDecorations(decorations: DecorationSpec[]): Promise<void> {
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
      .filter((d): d is { id: string; locator: Locator; style: string; color: string } =>
        d !== null
      );
    nav.applyDecorations(locators as never, "highlights");
  }

  private async getSearchIndex(): Promise<MiniSearch | null> {
    const pub = this.pub;
    if (!pub) return null;
    if (this.searchIndex) return this.searchIndex;
    if (this.searchIndexPromise) return this.searchIndexPromise;

    this.searchIndexPromise = (async () => {
      const { MiniSearch } = await import("../search/miniSearch");
      const idx = new MiniSearch();
      const bookTitle =
        typeof pub.metadata?.title === "string" ? pub.metadata.title : undefined;
      for (const link of pub.readingOrder.items) {
        let text = "";
        try {
          const bytes = await pub.get(link).read();
          if (bytes) text = stripHtml(strFromU8(bytes));
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
    if (!query.trim() || !this.pub) return [];
    const idx = await this.getSearchIndex();
    if (!idx || !this.pub) return [];
    const hits = idx.search(query, 50);
    return hits.map((h) => ({
      chapterTitle: h.chapterTitle ?? "",
      snippetHtml: h.snippet,
      locator: h.href ?? h.id,
    }));
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
    this.navigator?.go(locator, true, () => {});
    return true;
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
      (l) => l.href === href || decodeHref(l.href) === href
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

  private extractContext(targetFrameSrc: string, quote: string): { prefix: string; suffix: string } {
    try {
      const frame = Array.from(document.querySelectorAll("iframe")).find(
        (f) => f.src === targetFrameSrc
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

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
