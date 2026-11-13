// Highlight decoration mapping (04 §6): annotations → engine DecorationSpec.
// Highlights carry the text quote as their anchor so the range survives
// repagination and a new edition's CSS. Annotations written by mobile have the
// quote in separate fields rather than in `location`, so merge them here.
import type { Annotation } from "../../model/types";
import type { DecorationSpec } from "../../reader/ReaderEngine";
import { withAnchor } from "../../reader/locatorCodec";

const HIGHLIGHT_CSS: Record<string, string> = {
  yellow: "#FFF3B0",
  green: "#CDE8C2",
  blue: "#BFDFF7",
  pink: "#F8CFE0",
};

export function decorationsFor(annotations: Annotation[]): DecorationSpec[] {
  return annotations
    .filter((a) => a.kind === "highlight" && a.location)
    .map((a) => ({
      id: a.id,
      locator: withAnchor(
        a.location as string,
        a.quote.trim() ? { quote: a.quote, prefix: a.prefix, suffix: a.suffix } : null,
      ),
      style: "highlight",
      color: HIGHLIGHT_CSS[a.color ?? "yellow"] ?? HIGHLIGHT_CSS.yellow,
    }));
}
