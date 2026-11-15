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
  // ---- PDF additions (optional; Readium never sets them) -------------------
  /** 1-based physical page the reading line sits on */
  page?: number;
  pageCount?: number;
  /** display label from the PDF page labels ("iv", "A-3"); never stored */
  pageLabel?: string;
}

/** What UI differences a document drives (PDF plan §2 rule 6): one object, not
 *  scattered `if (pdf)` checks. Readium leaves `capabilities` undefined, which
 *  the UI reads as reflowable with typography. */
export interface ReaderCapabilities {
  format: "reflowable" | "fixed";
  typography: boolean;
  zoom: boolean;
  flow: boolean;
  spread: boolean;
  pageCount?: number;
  /** D2: the document grants no copy permission — Copy / Share-as-image are
   *  disabled (reading never blocked). Readium leaves it undefined. */
  noCopy?: boolean;
}

export interface ReaderPageInfo {
  /** 1-based physical page */
  page: number;
  pageCount: number;
  label?: string;
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
  /** Right-click in the spine frame (native menu is suppressed by the
   *  navigator); return true when a menu was shown (07 §3). */
  onContextMenu(cb: (info: ReaderClickInfo) => boolean): () => void;
  /** Pointer movement over the publication (chrome reveal, 07 §2). */
  onPointerActivity(cb: () => void): () => void;
  /** Anchored jump used as the second step of two-step jumps (04 §8). */
  goAnchored?(quote: string, prefix: string, suffix: string): Promise<boolean>;

  // ---- Optional capabilities (PDF plan §7.1; Readium engine never sets them)
  /** UI differences for this document. Undefined ⇒ reflowable with typography. */
  capabilities?: ReaderCapabilities;
  /** Current physical page, when the engine is fixed-layout. */
  pageInfo?(): ReaderPageInfo | null;
  /** Zoom: "fit-width" | "fit-page" | absolute scale (1 = 96/72 CSS px/pt). */
  setZoom?(zoom: "fit-width" | "fit-page" | number): Promise<void>;
  zoomBy?(direction: 1 | -1): Promise<void>;
  getZoom?(): "fit-width" | "fit-page" | number | null;
  /** One line step (48 px) for arrow keys in continuous fixed layout. */
  scrollStep?(direction: 1 | -1): Promise<boolean>;
  /** Drop the live selection so highlight colours are visible. */
  clearSelection?(): void;
  /** A highlight/annotation box was clicked (hook for the popover, R5).
   *  `at` is the click position in engine-container CSS coordinates when the
   *  engine can supply one (PDF); absent for engines without hit-testing. */
  onDecorationClick?(cb: (id: string, at?: { x: number; y: number }) => void): () => void;
  /** Document loading progress 0..1 (keeps the splash failsafe alive). */
  onProgress?(cb: (fraction: number) => void): () => void;
}

export interface CreateEngineArgs {
  /** "epub" today; "pdf" once the PDF engine lands (flag-gated). */
  format: "epub" | "pdf";
  /** bytes of the reading file (reading/book.epub or reading/book.pdf) */
  readingBytes: Uint8Array;
  prefs: ReadingPrefs;
  initial?: ReaderOpenTarget | null;
  /** PDF in-book search text provider (Phase 3); epub ignores it. */
  pageTextProvider?: (page: number) => Promise<string | null>;
}

/** Deprecated alias kept so existing factories/tests compile (rule 9). */
export interface ReaderEngineFactory {
  /** bytes of reading/book.epub + resolved prefs + optional resume target */
  create(args: {
    epubBytes: Uint8Array;
    prefs: ReadingPrefs;
    initial?: ReaderOpenTarget | null;
  }): ReaderEngine;
}
