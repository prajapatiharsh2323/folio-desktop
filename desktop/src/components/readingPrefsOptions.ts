import type { FontFamilyPref, ReadingTheme } from "../model/types";

/** Reading-theme options shared by the per-book panel and global defaults. */
export const READING_THEME_OPTIONS: { value: ReadingTheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "warm", label: "Paper" },
  { value: "dark", label: "Dark" },
  { value: "true-black", label: "True black" },
  { value: "system", label: "System" },
];

/** Typeface options shared by the per-book panel and global defaults. */
export const TYPEFACE_OPTIONS: {
  value: FontFamilyPref;
  label: string;
  css: string;
}[] = [
  { value: "serif", label: "Serif", css: '"Iowan Old Style", Georgia, serif' },
  { value: "sans", label: "Sans", css: '"Segoe UI", system-ui, sans-serif' },
  { value: "mono", label: "Mono", css: '"Cascadia Code", Consolas, monospace' },
  { value: "publisher", label: "Publisher", css: "var(--folio-font-display)" },
];
