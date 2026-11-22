// Highlight decoration mapping (04 §6): annotations → engine DecorationSpec.
// Highlights carry the text quote as their anchor so the range survives
// repagination and a new edition's CSS. Annotations written by mobile have the
// quote in separate fields rather than in `location`, so merge them here.
import type { Annotation } from "../../model/types";
import type { DecorationSpec } from "../../reader/ReaderEngine";
import { MAX_DECORATION_ANCHOR_CHARS, withAnchor } from "../../reader/locatorCodec";
import { highlightCss } from "../../reader/highlightPalette";
import type { ResolvedTheme } from "../../reader/readerThemes";

export function decorationsFor(
  annotations: Annotation[],
  theme: ResolvedTheme | ResolvedTheme["theme"],
): DecorationSpec[] {
  return annotations
    .filter((a) => a.kind === "highlight" && a.location)
    .map((a) => ({
      id: a.id,
      locator: withAnchor(
        a.location as string,
        a.quote.trim() ? { quote: a.quote, prefix: a.prefix, suffix: a.suffix } : null,
        MAX_DECORATION_ANCHOR_CHARS,
      ),
      style: "highlight",
      color: highlightCss(a.color, theme),
    }));
}
