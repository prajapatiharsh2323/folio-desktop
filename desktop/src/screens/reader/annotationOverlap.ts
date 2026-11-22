// Highlight overlap decisions (R5): re-highlighting a span that already has a
// highlight must update or toggle the existing annotation, never create an
// overlapping duplicate. Quote containment alone is not enough — a repeated
// phrase in the same chapter would collide — so the stored prefix/suffix
// context and locator progression are used as disambiguators. When two
// candidate spans are indistinguishable we create a new highlight instead of
// guessing, so identical quotes never interfere with each other.
import type { Annotation } from "../../model/types";
import { decodeLocation } from "../../reader/locatorCodec";

/** The minimum information needed to disambiguate a selected quote. */
export interface TextAnchorSelection {
  quote: string;
  prefix?: string | null;
  suffix?: string | null;
  /** optional locator hint, used only as a progression tie-breaker */
  location?: string | null;
}

/** Chapter (resource href / PDF page locator) of a stored location, or null. */
export function chapterOf(location: string | null | undefined): string | null {
  return decodeLocation(location)?.href || null;
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}_]/u.test(ch);
}

/** True when `short` occurs in `long` as a whole span, not inside a word. */
function containsSpan(long: string, short: string): boolean {
  if (!short) return false;
  let from = 0;
  for (;;) {
    const at = long.indexOf(short, from);
    if (at < 0) return false;
    const before = at === 0 ? undefined : long[at - 1];
    const after = at + short.length >= long.length ? undefined : long[at + short.length];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

/** True when either quote textually contains the other (same text span). */
export function quotesOverlap(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return containsSpan(x, y) || containsSpan(y, x);
}

function norm(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Are two context snippets compatible (one is a window of the other)? */
function contextCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return true; // unknown context cannot contradict
  return x.includes(y) || y.includes(x);
}

function progressionOf(location: string | null | undefined): number | undefined {
  return decodeLocation(location)?.progression;
}

/** Progression is only a tie-breaker: a highlight covers a range, so a
 *  selection inside it can legitimately sit a little past its start. */
function progressionCompatible(
  locationA: string | null | undefined,
  locationB: string | null | undefined,
): boolean {
  const a = progressionOf(locationA);
  const b = progressionOf(locationB);
  if (a === undefined || b === undefined) return true;
  return Math.abs(a - b) <= 0.05;
}

function contextScore(annotation: Annotation, selection: TextAnchorSelection): number {
  let score = 0;
  if (norm(annotation.prefix) && norm(selection.prefix)) score += 1;
  if (norm(annotation.suffix) && norm(selection.suffix)) score += 1;
  const a = progressionOf(annotation.location);
  const b = progressionOf(selection.location);
  if (a !== undefined && b !== undefined && Math.abs(a - b) <= 0.01) score += 0.5;
  return score;
}

/**
 * The existing highlight a selection overlaps, if any. Same resource, quote
 * containment with word boundaries, and compatible prefix/suffix context.
 * Bookmarks and notes are never matches.
 */
export function findOverlappingHighlight(
  annotations: Annotation[],
  location: string | null | undefined,
  selection: string | TextAnchorSelection,
): Annotation | null {
  const sel: TextAnchorSelection =
    typeof selection === "string"
      ? { quote: selection, location }
      : { ...selection, location: selection.location ?? location };
  if (!sel.quote || !sel.quote.trim()) return null;
  const chapter = chapterOf(location);
  const candidates = annotations.filter((a) => {
    if (a.kind !== "highlight" || !a.quote) return false;
    const aChapter = chapterOf(a.location);
    // Both chapter hints are optional (mobile CFI records); when both exist
    // they must agree. A missing chapter is no longer a wildcard across the
    // whole book — that used to make repeated phrases collide everywhere.
    if (chapter !== null && aChapter !== null && chapter !== aChapter) return false;
    if (chapter === null && aChapter !== null) return false;
    return (
      quotesOverlap(a.quote, sel.quote) &&
      contextCompatible(a.prefix, sel.prefix) &&
      contextCompatible(a.suffix, sel.suffix) &&
      progressionCompatible(a.location, location)
    );
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Ambiguous: prefer the candidate backed by more context, but never guess
  // when the evidence is tied — creating a second highlight is safer than
  // deleting or recolouring the wrong one.
  const scored = candidates
    .map((a) => ({ a, score: contextScore(a, sel) }))
    .sort((x, y) => y.score - x.score);
  return scored[0].score > 0 && scored[0].score > (scored[1]?.score ?? -1) ? scored[0].a : null;
}

/** What re-highlighting an overlapping span should do. */
export type HighlightAction = "toggle-off" | "recolour" | "create";

export function highlightAction(existing: Annotation | null, color: string): HighlightAction {
  if (!existing) return "create";
  return existing.color === color ? "toggle-off" : "recolour";
}
