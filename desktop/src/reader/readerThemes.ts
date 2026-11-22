// Reader themes, typefaces, chrome surfaces, scrim — exact hex values (04 §2, §4, §6; 03 §5.3).
import { TextAlignment } from "@readium/navigator";
import type { ReadingPrefs, ReadingTheme } from "../model/types";
import { READER_THEME_COLORS } from "../model/defaults";

export interface ResolvedTheme {
  /** the concrete theme after "system" resolution */
  theme: Exclude<ReadingTheme, "system">;
  pageBg: string;
  pageText: string;
  /** chrome surface / text pair per resolved theme (03 §5.3) */
  chromeSurface: string;
  chromeText: string;
  /** content link / visited colours for publisher-styled documents */
  link: string;
  visited: string;
  /** selection colours so highlighted text stays legible in every theme */
  selectionBg: string;
  selectionText: string;
}

export function resolveReaderTheme(theme: ReadingTheme, systemDark: boolean): ResolvedTheme {
  const resolved: Exclude<ReadingTheme, "system"> =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const colors = READER_THEME_COLORS[resolved];
  const chrome =
    resolved === "light"
      ? "rgba(255,254,251,.92)"
      : resolved === "warm"
        ? "rgba(244,236,216,.94)"
        : resolved === "dark"
          ? "rgba(18,18,20,.92)"
          : "rgba(0,0,0,.92)"; // true-black
  const dark = resolved === "dark" || resolved === "true-black";
  return {
    theme: resolved,
    pageBg: colors.bg,
    pageText: colors.text,
    chromeSurface: chrome,
    chromeText: colors.text,
    link: dark ? "#8AB4F8" : "#0B57D0",
    visited: dark ? "#C58AF9" : "#6B2FA0",
    selectionBg: dark ? "#5A4010" : "#FFD27F",
    selectionText: colors.text,
  };
}

/** Typeface stacks (04 §4). publisher → null (honor EPUB CSS). */
export function typefaceStack(fontFamily: ReadingPrefs["fontFamily"]): string | null {
  switch (fontFamily) {
    case "serif":
      return `"Iowan Old Style", "Palatino Linotype", Georgia, serif`;
    case "sans":
      return `"Segoe UI", system-ui, sans-serif`;
    case "mono":
      return `"Cascadia Code", Consolas, monospace`;
    case "publisher":
      return null;
  }
}

/** Brightness scrim: black overlay alpha = (100 − brightness)/100 × 0.7, under chrome. */
export function scrimAlpha(brightness: number): number {
  const b = Math.min(100, Math.max(30, brightness));
  return ((100 - b) / 100) * 0.7;
}

/** Map Folio ReadingPrefs → toolkit EpubPreferences-shaped object (04 §3):
 *  fontSize factor = px/16; pageGutter (margin) em at 16px base; letter/paragraph
 *  spacing in em; scroll from flow; justify/hyphenate passthrough. */
export function toNavigatorPreferences(
  prefs: ReadingPrefs,
  theme: ResolvedTheme,
  respectPublisherColors = false,
) {
  const font = typefaceStack(prefs.fontFamily);
  return {
    // `null` clears a previous user override in Readium's preference merge,
    // letting the publisher's own background/text colours win. This is the
    // additive "Publisher" presentation mode (not a schema-1 enum value).
    backgroundColor: respectPublisherColors ? null : theme.pageBg,
    textColor: respectPublisherColors ? null : theme.pageText,
    fontFamily: font,
    fontSize: prefs.fontSize / 16,
    lineHeight: prefs.lineHeight,
    pageGutter: prefs.margin / 16,
    hyphens: prefs.hyphenate,
    textAlign: prefs.justify ? TextAlignment.justify : TextAlignment.start,
    letterSpacing: prefs.letterSpacing,
    paragraphSpacing: prefs.paragraphSpacing,
    scroll: prefs.flow === "scrolled",
    columnCount: resolveEpubColumnCount(
      prefs,
      typeof window !== "undefined" ? window.innerWidth : 0,
    ),
    // Readium's injected ReadiumCSS-after rules force these onto publisher
    // stylesheets and inline styles, so links/headings/tables stay readable
    // on both light and dark pages without inverting image content.
    linkColor: respectPublisherColors ? null : theme.link,
    visitedColor: respectPublisherColors ? null : theme.visited,
    selectionBackgroundColor: theme.selectionBg,
    selectionTextColor: theme.selectionText,
  };
}

/**
 * F9 5.2a: EPUB two-page spread from the existing `spread` pref (PDF already
 * honors it). Scrolled flow is always single-column; paginated flow maps
 * `both` → 2 columns and `auto` → 2 columns only on a wide viewport
 * (Readium degrades the request to 1 column when the window is too narrow,
 * but we gate `auto` ourselves so the default window width behaves like PDF's
 * landscape rule). `none` (the default) stays single-column.
 */
export const EPUB_SPREAD_MIN_WIDTH = 1200;

export function resolveEpubColumnCount(
  prefs: ReadingPrefs,
  viewportWidth: number,
): 1 | 2 | undefined {
  if (prefs.flow === "scrolled") return 1;
  if (prefs.spread === "both") return 2;
  if (prefs.spread === "auto") return viewportWidth >= EPUB_SPREAD_MIN_WIDTH ? 2 : 1;
  return undefined;
}
