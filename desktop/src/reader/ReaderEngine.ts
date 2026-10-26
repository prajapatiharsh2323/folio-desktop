// Reader engine seam (prompt-pack tip #4): everything above this interface is
// engine-agnostic, so a future engine swap doesn't reopen the app.
import type { ReadingPrefs } from "../model/types";

export interface ReaderLocator {
  /** CFI string (epubcfi(...)) when the engine provides one, else chapter href */
  location: string;
  /** 0..1 total progression, if known */
  progression?: number;
  /** chapter title + href for the pillar */
  chapterTitle?: string;
  chapterHref?: string;
}

/** Where to start reading. Produced by the resume cascade (04 §8). */
export interface ReaderOpenTarget {
  /** chapter href (optionally with #fragment) — ignored when it is a CFI */
  location?: string | null;
  /** 0..100 total progression, used when no usable location exists */
  percent?: number | null;
}

export interface TextSelectionInfo {
  quote: string;
  prefix: string;
  suffix: string;
  location: string;
  chapterId?: string | null;
  /** page-relative rect for anchoring the floating toolbar (CSS px, viewport coords) */
  rect: { top: number; left: number; bottom: number; right: number };
}

export interface DecorationSpec {
  id: string;
  locator: string;
  style: string; // "highlight"
  color: string;
}

export interface SearchHit {
  chapterTitle: string;
  snippetHtml: string;
  locator: string;
}

export interface TocEntry {
  title: string;
  href: string;
  depth: number;
}

export interface ReaderClickInfo {
  /** click position inside the spine frame (CSS px) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** true when the click landed on an interactive element (link, button, …) */
  interactive: boolean;
  defaultPrevented: boolean;
}

export interface ReaderEngine {
  /** Resolve and mount the publication. Rejects on parse failure (04 §1 step 2). */
  open(container: HTMLElement): Promise<void>;
  destroy(): Promise<void>;
  /** Apply ReadingPrefs to the canvas. */
  applyPrefs(prefs: ReadingPrefs): Promise<void>;
  go(locator: string | { percent: number }, animated?: boolean): Promise<boolean>;
  goForward(): Promise<boolean>;
  goBackward(): Promise<boolean>;
  /** Current locator (throttled by the engine). */
  currentLocator(): ReaderLocator | null;
  /** 0..1 positions list for fraction recompute (resume cascade fallback). */
  totalProgression(): number | null;
  /** Paint highlights/underlines; group per mobile. */
  applyDecorations(decorations: DecorationSpec[]): Promise<void>;
  /** Search the whole book (streaming not modeled here; batch is fine for v1). */
  search(query: string): Promise<SearchHit[]>;
  /** Parsed table of contents, flattened with depth. */
  toc(): TocEntry[];
  /** Selection events. */
  onSelection(cb: (sel: TextSelectionInfo | null) => void): () => void;
  /** Locator events. */
  onLocator(cb: (loc: ReaderLocator) => void): () => void;
  /** External/internal link interception. Return true when handled. */
  onLink(cb: (href: string) => boolean): () => void;
  /** Click events in the spine frame; return true when consumed. */
  onClick(cb: (info: ReaderClickInfo) => boolean): () => void;
  /** Anchored jump used as the second step of two-step jumps (04 §8). */
  goAnchored?(quote: string, prefix: string, suffix: string): Promise<boolean>;
}

export interface ReaderEngineFactory {
  /** bytes of reading/book.epub + resolved prefs + optional resume target */
  create(args: {
    epubBytes: Uint8Array;
    prefs: ReadingPrefs;
    initial?: ReaderOpenTarget | null;
  }): ReaderEngine;
}
