// Single source of truth for canvas decoration fills (R16): annotation
// highlight tints and the in-book search "active match" colour, with a light
// and a dark variant per name. The engine paints decorations with explicit
// colours, so every painter resolves through here with the OS dark flag —
// highlights and search matches stay readable on all four reader themes
// (contrast is pinned by tests/highlightPalette.test.ts).
//
// Out of scope on purpose: the chrome-side `--folio-swatch-*` CSS variables
// (SelectionToolbar, TocPanel, NotesScreen) keep their fixed light tints —
// chrome surfaces don't flip with the book canvas's reader theme.

export type HighlightPalette = {
  yellow: string;
  green: string;
  blue: string;
  pink: string;
};

/** Page tints for light reader themes (light, warm). */
export const HIGHLIGHT_LIGHT: HighlightPalette = {
  yellow: "#FFF3B0",
  green: "#CDE8C2",
  blue: "#BFDFF7",
  pink: "#F8CFE0",
};

/** Page tints for dark reader themes (dark, true-black). */
export const HIGHLIGHT_DARK: HighlightPalette = {
  yellow: "#55481C",
  green: "#1E4630",
  blue: "#1D3A52",
  pink: "#552A3C",
};

/** Resolve an annotation's colour name to a canvas fill for the given theme. */
export function highlightCss(color: string | null | undefined, systemDark: boolean): string {
  const palette: Record<string, string> = systemDark ? HIGHLIGHT_DARK : HIGHLIGHT_LIGHT;
  const name = color ?? "yellow";
  return palette[name] ?? palette.yellow;
}

/** Active in-book search match: distinct from the highlight tints. */
export function searchActiveCss(systemDark: boolean): string {
  return systemDark ? "#5A4010" : "#FFD27F";
}
