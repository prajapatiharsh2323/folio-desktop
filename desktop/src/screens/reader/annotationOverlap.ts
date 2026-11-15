// Highlight overlap decisions (R5): re-highlighting a span that already has a
// highlight must update or toggle the existing annotation, never create an
// overlapping duplicate. Text-quote anchors are the authoritative span, so
// overlap is decided by quote containment within the same chapter.
import type { Annotation } from "../../model/types";
import { decodeLocation } from "../../reader/locatorCodec";

/** Chapter (resource href) of a text-anchored location, or null. */
export function chapterOf(location: string | null | undefined): string | null {
  return decodeLocation(location)?.href || null;
}

/** True when either quote textually contains the other (same text span). */
export function quotesOverlap(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) return false;
  const lx = x.toLowerCase();
  const ly = y.toLowerCase();
  return lx.includes(ly) || ly.includes(lx);
}

/**
 * The existing highlight a selection overlaps, if any: same chapter, quote
 * containment either way. Bookmarks and notes are never matches.
 */
export function findOverlappingHighlight(
  annotations: Annotation[],
  location: string | null | undefined,
  quote: string,
): Annotation | null {
  const chapter = chapterOf(location);
  return (
    annotations.find(
      (a) =>
        a.kind === "highlight" &&
        (chapter === null || chapterOf(a.location) === chapter) &&
        quotesOverlap(a.quote, quote),
    ) ?? null
  );
}

/** What re-highlighting an overlapping span should do. */
export type HighlightAction = "toggle-off" | "recolour" | "create";

export function highlightAction(existing: Annotation | null, color: string): HighlightAction {
  if (!existing) return "create";
  return existing.color === color ? "toggle-off" : "recolour";
}
