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
  return {
    theme: resolved,
    pageBg: colors.bg,
    pageText: colors.text,
    chromeSurface: chrome,
    chromeText: colors.text,
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
export function toNavigatorPreferences(prefs: ReadingPrefs, theme: ResolvedTheme) {
  const font = typefaceStack(prefs.fontFamily);
  return {
    backgroundColor: theme.pageBg,
    textColor: theme.pageText,
    fontFamily: font,
    fontSize: prefs.fontSize / 16,
    lineHeight: prefs.lineHeight,
    pageGutter: prefs.margin / 16,
    hyphens: prefs.hyphenate,
    textAlign: prefs.justify ? TextAlignment.justify : TextAlignment.start,
    letterSpacing: prefs.letterSpacing,
    paragraphSpacing: prefs.paragraphSpacing,
    scroll: prefs.flow === "scrolled",
    columnCount: prefs.flow === "scrolled" ? 1 : undefined,
  };
}
