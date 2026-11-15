// Reader engine seam (prompt-pack tip #4): everything above this interface is
// engine-agnostic, so a future engine swap doesn't reopen the app.
import type { ReadingPrefs } from "../model/types";
import type { SnippetParts } from "../search/occurrences";

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
  /** decoration group; annotations use "highlights", search uses "search" */
  group?: string;
}

/** Text-quote anchor for landing exactly on a search match (04 §8). */
export interface SearchAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface SearchHit {
  chapterTitle: string;
  /** L9: structured snippet — the panel renders `<mark>` React nodes. */
  snippet: SnippetParts;
  /** chapter href for the landing jump */
  locator: string;
  /** text anchor so the second-step jump lands on the match, not the chapter start */
  anchor?: SearchAnchor;
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

/**
 * A noteref activation ready for the footnote popover (R4 2.2b). The point is
 * host-relative CSS px; the html is sanitized body markup (no scripts, no
 * remote assets). No navigation occurred — the reader stays where it was.
 */
export interface NoterefActivation {
  x: number;
  y: number;
  html: string;
  text: string;
  /** Zip-absolute footnote target, e.g. "OEBPS/notes.xhtml#fn1". */
  source: string;
}

/**
 * A highlight decoration was clicked in the frame (R5). `id` is the
 * annotation id for the "highlights" group; the point is host-relative CSS px.
 */
export interface HighlightActivation {
  id: string;
  group: string;
  x: number;
  y: number;
}

/** Progress while a book opens (R12), for the splash bar. */
export interface EngineOpenProgress {
  stage: "unpack" | "prepare";
  /** 0..1 when known; null = indeterminate (unpack stage). */
  fraction: number | null;
}

export interface ReaderEngine {
  /** Resolve and mount the publication. Rejects on parse failure (04 §1 step 2). */
  open(container: HTMLElement, onProgress?: (progress: EngineOpenProgress) => void): Promise<void>;
  destroy(): Promise<void>;
  /** Apply ReadingPrefs to the canvas. */
  applyPrefs(prefs: ReadingPrefs): Promise<void>;
  /**
   * OS dark-mode flag changed (R9): repaint "system" reader themes by
   * re-submitting the current prefs with the resolved system colours.
   */
  setSystemDark(dark: boolean): Promise<void>;
  go(locator: string | { percent: number }, animated?: boolean): Promise<boolean>;
  goForward(): Promise<boolean>;
  goBackward(): Promise<boolean>;
  /** Current locator (throttled by the engine). */
  currentLocator(): ReaderLocator | null;
  /** 0..1 positions list for fraction recompute (resume cascade fallback). */
  totalProgression(): number | null;
  /**
   * Start percent (0..100) of each spine resource in reading order (R11):
   * progress-slider chapter ticks and scrub tooltips. Empty until open().
   */
  chapterMarks(): { href: string; percent: number }[];
  /** Paint highlights/underlines; group per mobile. Passing a group replaces
   *  only that group's decorations (annotations: "highlights", search: "search"). */
  applyDecorations(decorations: DecorationSpec[], group?: string): Promise<void>;
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
  /**
   * In-content internal link interception (footnotes, cross-references).
   * Receives the link's locator as a resumable location string; return true
   * when the move was routed (e.g. through the navigation coordinator).
   */
  onInternalLink(cb: (locator: string) => boolean): () => void;
  /**
   * Noteref activations (R4 2.2b). Fired instead of navigation when the
   * reader taps `epub:type="noteref"` / `role="doc-noteref"`; null means the
   * footnote body could not be extracted (caller shows a notice). The
   * position is host-relative CSS px for the popover.
   */
  onNoteref(cb: (activation: NoterefActivation | null) => void): () => void;
  /**
   * Highlight decoration activation (R5). Fired when the reader clicks a
   * painted highlight in the "highlights" group; return true when the host
   * consumed it (opens the annotation popover).
   */
  onHighlightActivated(cb: (activation: HighlightActivation) => boolean): () => void;
  /** Click events in the spine frame; return true when consumed. */
  onClick(cb: (info: ReaderClickInfo) => boolean): () => void;
  /** Right-click in the spine frame (native menu is suppressed by the
   *  navigator); return true when a menu was shown (07 §3). */
  onContextMenu(cb: (info: ReaderClickInfo) => boolean): () => void;
  /** Pointer movement over the publication (chrome reveal, 07 §2). */
  onPointerActivity(cb: () => void): () => void;
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
