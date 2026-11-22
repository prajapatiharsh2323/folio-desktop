// Format-specific reader preference models. The schema-1 `ReadingPrefs` in
// `types.ts` is frozen for mobile compatibility and stays the engine-facing
// shape; these models describe what each format's settings UI owns. New
// desktop-only PDF values live in an additive `user/pdf-prefs.json`, never in
// the schema-1 files.

import type {
  FontFamilyPref,
  ReadingFlow,
  ReadingPrefs,
  ReadingSpread,
  ReadingTheme,
} from "./types";

/**
 * Reflowable reader preferences — the EPUB-owned subset of the legacy flat
 * prefs. It deliberately maps 1:1 onto the engine-facing `ReadingPrefs` so the
 existing Readium adapter and per-doc schema-1 storage are unchanged.
 */
export interface EpubReaderPrefs {
  theme: ReadingTheme;
  fontFamily: FontFamilyPref;
  fontSize: number;
  lineHeight: number;
  margin: number;
  justify: boolean;
  hyphenate: boolean;
  paragraphSpacing: number;
  letterSpacing: number;
  maxWidth: number;
  brightness: number;
  flow: ReadingFlow;
  spread: ReadingSpread;
}

/** Page presentation applied to the PDF page itself (not just the surround). */
export type PdfPresentation = "original" | "warm" | "dim" | "night";
export type PdfDirection = "ltr" | "rtl";
export type PdfRotation = 0 | 90 | 180 | 270;
export type PdfZoomPref = "fit-width" | "fit-page" | "actual" | number;

/** Desktop-only fixed-layout preferences (additive, global + per-document). */
export interface PdfReaderPrefs {
  theme: ReadingTheme;
  brightness: number;
  flow: ReadingFlow;
  spread: ReadingSpread;
  zoom: PdfZoomPref;
  presentation: PdfPresentation;
  coverFirst: boolean;
  direction: PdfDirection;
  rotation: PdfRotation;
  /** vertical gutter between pages / spread rows, CSS px */
  pageSpacing: number;
  /** surrounding background outside the page */
  background: "theme" | "neutral" | "black";
  /** show the page thumbnail strip and direct page-number box */
  thumbnails: boolean;
  /** hand/pan navigation while zoomed */
  pan: boolean;
  pageNumber: boolean;
  /** open the reader in a distraction-free workspace */
  focusWorkspace: boolean;
}

export const DEFAULT_PDF_READER_PREFS: PdfReaderPrefs = {
  theme: "light",
  brightness: 100,
  flow: "paginated",
  spread: "auto",
  zoom: "fit-width",
  presentation: "original",
  coverFirst: true,
  direction: "ltr",
  rotation: 0,
  pageSpacing: 16,
  background: "theme",
  thumbnails: false,
  pan: false,
  pageNumber: true,
  focusWorkspace: false,
};

/** Extract the EPUB-owned fields from the legacy schema-1 prefs. */
export function epubPrefsFrom(prefs: ReadingPrefs): EpubReaderPrefs {
  return {
    theme: prefs.theme,
    fontFamily: prefs.fontFamily,
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    margin: prefs.margin,
    justify: prefs.justify,
    hyphenate: prefs.hyphenate,
    paragraphSpacing: prefs.paragraphSpacing,
    letterSpacing: prefs.letterSpacing,
    maxWidth: prefs.maxWidth,
    brightness: prefs.brightness,
    flow: prefs.flow,
    spread: prefs.spread,
  };
}

/**
 * Seed PDF preferences from an older user's existing global prefs. Only the
 * four shared meanings (theme, brightness, flow, spread) are carried over;
 * the legacy `pdfZoom` byte-compat field is ignored, never repurposed.
 */
export function pdfPrefsFromLegacy(prefs: ReadingPrefs): PdfReaderPrefs {
  return {
    ...DEFAULT_PDF_READER_PREFS,
    theme: prefs.theme,
    brightness: prefs.brightness,
    flow: prefs.flow,
    spread: prefs.spread,
  };
}

/** Merge a stored (possibly older/partial) PDF record with defaults, keeping
 *  unknown keys so a future desktop version can add fields safely. */
export function resolvePdfPrefs(
  stored: Partial<PdfReaderPrefs> | null | undefined,
): PdfReaderPrefs {
  return { ...DEFAULT_PDF_READER_PREFS, ...(stored ?? {}) } as PdfReaderPrefs;
}

/** Build the engine-facing schema-1 view from PDF-specific prefs. The dead
 *  `pdfZoom` field stays empty — zoom remains engine session state. */
export function pdfToReadingPrefs(prefs: PdfReaderPrefs): ReadingPrefs {
  return {
    schema: 1,
    theme: prefs.theme,
    fontFamily: "serif",
    fontSize: 18,
    lineHeight: 1.6,
    margin: 20,
    justify: false,
    hyphenate: false,
    paragraphSpacing: 0,
    letterSpacing: 0,
    maxWidth: 0, // PDF never inherits the EPUB reading-width cap
    brightness: prefs.brightness,
    flow: prefs.flow,
    spread: prefs.spread,
    pdfZoom: "",
  };
}
