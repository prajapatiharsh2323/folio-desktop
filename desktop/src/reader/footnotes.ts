// Noteref footnote support (R4 2.2b, 04 §2): clicking a `epub:type="noteref"`
// anchor opens the footnote body in a popover instead of navigating.
//
// The navigator routes interactive-element clicks through its comms
// (`pointerup` → `click` message → internal navigation) and never consults
// host listeners for internal links, so interception happens in-frame: the
// engine attaches capture-phase listeners on each frame document (frames are
// same-origin) that run before the toolkit's bubble-phase Peripherals
// handler. This module holds the pure, testable pieces — anchor detection,
// the interception handler factory, and footnote body extraction from the
// zip-backed publication.
import { strFromU8 } from "fflate";
import { sanitizeHtml } from "../import/sanitize";
import { htmlToText } from "../lib/htmlToText";
import { dirname, resolveEpubHref, zipEntry } from "./epubPublication";

/** epub:type namespace for EPUB 3 semantic attributes. */
const EPUB_TYPE_NS = "http://www.idpf.org/2007/ops";

/**
 * Is this anchor a noteref? Handles both spellings: `epub:type="noteref"`
 * (EPUB 3) and `role="doc-noteref"` (DPUB-ARIA). Attribute lookups cover the
 * XHTML-namespaced form via getAttributeNS as well as the plain-HTML one.
 */
export function isNoterefAnchor(el: Element | null): boolean {
  if (!el) return false;
  if (el.localName.toLowerCase() !== "a") return false;
  const semantic = el.getAttribute("epub:type") ?? el.getAttributeNS(EPUB_TYPE_NS, "type") ?? "";
  if (semantic.split(/\s+/).includes("noteref")) return true;
  const role = el.getAttribute("role") ?? "";
  return role.split(/\s+/).includes("doc-noteref");
}

/** Nearest noteref anchor for an event target, or null. */
export function nearestNoteref(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  return isNoterefAnchor(anchor) ? (anchor as HTMLAnchorElement) : null;
}

export interface NoterefInterceptHooks {
  /** Any non-collapsed text selection means the pointerup belongs to it. */
  hasSelection: () => boolean;
  /** A noteref was activated by the user. */
  onActivate: (anchor: HTMLAnchorElement, ev: PointerEvent | MouseEvent) => void;
}

export interface NoterefIntercept {
  /** Capture-phase pointerup: beats the toolkit's bubble handler. */
  onPointerUp: (ev: Event) => void;
  /** Capture-phase click: suppresses the default anchor jump; keyboard
   *  activations (detail === 0) trigger the popover. */
  onClick: (ev: Event) => void;
}

/**
 * Handler pair for intercepting noteref activations before the navigator
 * sees them. Mouse/touch activations fire on pointerup (the click that
 * follows is suppressed); keyboard activations have no pointerup, so the
 * click handler triggers them.
 */
export function createNoterefIntercept(hooks: NoterefInterceptHooks): NoterefIntercept {
  return {
    onPointerUp(ev: Event) {
      const pe = ev as PointerEvent;
      if (pe.button !== 0 || pe.isPrimary === false) return;
      if (hooks.hasSelection()) return;
      const anchor = nearestNoteref(ev.target);
      if (!anchor) return;
      ev.preventDefault();
      ev.stopPropagation();
      hooks.onActivate(anchor, pe);
    },
    onClick(ev: Event) {
      const anchor = nearestNoteref(ev.target);
      if (!anchor) return;
      // The default fragment jump must never happen for noterefs.
      ev.preventDefault();
      ev.stopPropagation();
      // Keyboard activation (Enter on a focused noteref) has no pointerup.
      if ((ev as MouseEvent).detail === 0) hooks.onActivate(anchor, ev as MouseEvent);
    },
  };
}

/** A footnote body ready for the popover. */
export interface NoterefBody {
  /** Sanitized body HTML (safe to inject; no scripts, remote images or links). */
  html: string;
  /** Plain text of the body (a11y, blank check). */
  text: string;
}

/**
 * Extract and sanitize a footnote body from the zip-backed publication.
 * `target` is a zip-absolute href with an optional fragment
 * (e.g. "OEBPS/notes.xhtml#fn1"). The fragment's element is the body; without
 * a fragment the whole resource body is. Images are dropped: their sources
 * would need asset-resolver URLs the popover cannot have.
 */
export async function extractFootnote(
  zip: Record<string, Uint8Array>,
  target: string,
): Promise<NoterefBody | null> {
  const bare = target.split("#")[0];
  const frag = target.includes("#") ? target.slice(target.indexOf("#") + 1) : "";
  const entry = zipEntry(zip, bare);
  if (!entry) return null;

  const doc = new DOMParser().parseFromString(strFromU8(entry), "text/html");
  const el = frag ? doc.getElementById(frag) : doc.body;
  if (!el) return null;
  // Don't include the footnote's backlink in the popover body.
  for (const anchor of Array.from(el.querySelectorAll("a"))) {
    const semantic = anchor.getAttribute("epub:type") ?? "";
    const role = anchor.getAttribute("role") ?? "";
    if (semantic.split(/\s+/).includes("footnote") || role.split(/\s+/).includes("doc-footnote")) {
      anchor.remove();
    }
  }
  // Data-URI images would be rewritten to library paths by the sanitizer;
  // relative ones are dropped there too — neither can render in a popover.
  el.querySelectorAll("img, svg, video, audio").forEach((n) => n.remove());

  const { html } = await sanitizeHtml(el.innerHTML);
  const text = htmlToText(html);
  if (!text.trim()) return null;
  return { html, text };
}

/**
 * Resolve a noteref's href attribute against the chapter it appears in.
 * Returns a zip-absolute href (path + fragment), or null when unusable.
 */
export function resolveNoterefTarget(chapterHref: string, linkHref: string): string | null {
  if (!chapterHref || !linkHref) return null;
  const trimmed = linkHref.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null; // remote
  if (trimmed.startsWith("#")) return chapterHref + trimmed;
  return resolveEpubHref(dirname(chapterHref), trimmed);
}
