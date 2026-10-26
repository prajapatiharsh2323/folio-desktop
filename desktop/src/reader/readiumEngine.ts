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

const XHTML = "application/xhtml+xml";

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
  private lastLocator: ReaderLocator | null = null;
  private systemDark = false;

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
      contextMenu: () => {},
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
      if (!locator || /^epubcfi\(/i.test(locator)) return false;
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
    const locators = decorations.map((d, i) => ({
      id: decorations[i].id,
      locator: this.locatorFromString(d.locator) ?? this.currentBaseLocator() ?? new Locator({
        href: this.pub?.readingOrder.items[0]?.href ?? "",
        type: XHTML,
      }),
      style: decorations[i].style,
      color: decorations[i].color,
    }));
    nav.applyDecorations(locators as never, "highlights");
  }

  async search(query: string): Promise<SearchHit[]> {
    const pub = this.pub;
    if (!pub || !query.trim()) return [];
    const { MiniSearch } = await import("../search/miniSearch");
    const idx = new MiniSearch();
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
        text,
        chapterTitle: link.title ?? link.href,
      });
    }
    const hits = idx.search(query, 50);
    return hits.map((h) => ({
      chapterTitle: h.chapterTitle ?? "",
      snippetHtml: h.snippet,
      locator: h.id,
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
    if (target.location && !/^epubcfi\(/i.test(target.location)) {
      const loc = this.locatorFromString(target.location);
      if (loc) return loc;
    }
    if (typeof target.percent === "number") {
      return locatorForProgression(target.percent / 100, this.positions);
    }
    return null;
  }

  /** Convert a persisted location (chapter href, href#fragment) to a locator. */
  private locatorFromString(value: string): Locator | null {
    if (!value || /^epubcfi\(/i.test(value)) return null;
    const hash = value.indexOf("#");
    const href = hash >= 0 ? value.slice(0, hash) : value;
    const fragment = hash >= 0 ? value.slice(hash + 1) : "";
    const base =
      this.positions.find((p) => p.href === href) ??
      (this.pub?.readingOrder.items.some((l) => l.href === href)
        ? new Locator({
            href,
            type:
              this.pub?.readingOrder.items.find((l) => l.href === href)?.type ?? XHTML,
            locations: new LocatorLocations({ progression: 0 }),
          })
        : null);
    if (!base) return null;
    return fragment
      ? base.copyWithLocations({ fragments: [fragment] })
      : base;
  }

  private currentBaseLocator(): Locator | null {
    if (!this.lastLocator) return null;
    return this.locatorFromString(this.lastLocator.location);
  }

  private locatorToString(locator: Locator): string {
    const fragments = locator.locations.fragments ?? [];
    const fragment = fragments.find((f) => !/^epubcfi\(/i.test(f));
    return fragment ? `${locator.href}#${fragment}` : locator.href;
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

export function createReadiumEngine(args: {
  epubBytes: Uint8Array;
  prefs: ReadingPrefs;
  initial?: ReaderOpenTarget | null;
}): ReadiumEngine {
  return new ReadiumEngine(args.epubBytes, args.prefs, args.initial ?? null);
}
