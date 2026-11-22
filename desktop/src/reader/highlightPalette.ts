// Single source of truth for canvas decoration fills (R16): annotation
// highlight tints and the in-book search "active match" colour, with a light
// and a dark variant per name. The engine paints decorations with explicit
// colours, so every painter resolves through the *effective reader theme* —
// not the OS dark flag — because a manually selected Dark / True-black theme
// must get the dark palette even on a light Windows appearance, and Paper on
// a dark OS must still get the light palette. Contrast is pinned by
// tests/highlightPalette.test.ts.
//
// Out of scope on purpose: the chrome-side `--folio-swatch-*` CSS variables
// (SelectionToolbar, TocPanel, NotesScreen) keep their fixed light tints —
// chrome surfaces don't flip with the book canvas's reader theme.

import type { ResolvedTheme } from "./readerThemes";

export type HighlightPalette = {
  yellow: string;
  green: string;
  blue: string;
  pink: string;
};

/** Page tints for light reader themes (light, paper/warm). */
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

/** True when a resolved reader theme uses the dark highlight palette. */
export function isDarkReaderTheme(theme: ResolvedTheme["theme"]): boolean {
  return theme === "dark" || theme === "true-black";
}

/** Resolve an annotation's colour name to a canvas fill for the effective theme. */
export function highlightCss(
  color: string | null | undefined,
  theme: ResolvedTheme | ResolvedTheme["theme"],
): string {
  const resolved = typeof theme === "string" ? theme : theme.theme;
  const palette: Record<string, string> = isDarkReaderTheme(resolved)
    ? HIGHLIGHT_DARK
    : HIGHLIGHT_LIGHT;
  const name = color ?? "yellow";
  return palette[name] ?? palette.yellow;
}

/** Active in-book search match: distinct from the highlight tints. */
export function searchActiveCss(theme: ResolvedTheme | ResolvedTheme["theme"]): string {
  const resolved = typeof theme === "string" ? theme : theme.theme;
  return isDarkReaderTheme(resolved) ? "#5A4010" : "#FFD27F";
}
