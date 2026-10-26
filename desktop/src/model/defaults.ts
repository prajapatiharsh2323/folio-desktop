import type { ReadingPrefs } from "./types";

/** ReadingPrefs defaults (04-reader-spec.md §3). */
export const DEFAULT_READING_PREFS: ReadingPrefs = {
  schema: 1,
  theme: "light",
  fontFamily: "serif",
  fontSize: 18,
  lineHeight: 1.6,
  margin: 20,
  justify: false,
  hyphenate: false,
  paragraphSpacing: 0,
  letterSpacing: 0,
  maxWidth: 0,
  brightness: 100,
  flow: "paginated",
  spread: "auto",
  pdfZoom: "", // dead field, persisted for byte-compat only
};

export const READER_THEME_COLORS: Record<
  string,
  { bg: string; text: string }
> = {
  light: { bg: "#FAFAF7", text: "#1C1B19" },
  warm: { bg: "#F4ECD8", text: "#3B3226" },
  dark: { bg: "#121214", text: "#E6E3DC" },
  "true-black": { bg: "#000000", text: "#C8C4BC" },
  system: { bg: "#FAFAF7", text: "#1C1B19" }, // resolved at runtime by OS scheme
};

/** Clamp + round helpers for prefs ranges (04 §3). */
export function clampFontSize(px: number): number {
  return Math.min(32, Math.max(14, Math.round(px)));
}
export function clampLineHeight(v: number): number {
  return Math.min(2.4, Math.max(1.3, Math.round(v * 10) / 10));
}
export function clampMargin(px: number): number {
  return Math.min(64, Math.max(12, Math.round(px)));
}
export function clampBrightness(v: number): number {
  return Math.min(100, Math.max(30, Math.round(v)));
}
export function clampParagraphSpacing(v: number): number {
  return Math.min(0.8, Math.max(0, Math.round(v * 100) / 100));
}
export function clampLetterSpacing(v: number): number {
  return Math.min(0.1, Math.max(0, Math.round(v * 100) / 100));
}

/** percent 0..100, one decimal (05 §3). */
export function roundPercent(x: number): number {
  return Math.min(100, Math.max(0, Math.round(x * 10) / 10));
}
