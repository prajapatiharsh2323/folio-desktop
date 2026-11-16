// X3 (Phase 4): opt-in high-contrast mode.
//
// A boolean preference (localStorage `folio.ui.contrast` = "high"/"normal")
// that toggles the `folio-high-contrast` class on the document root; the CSS
// side raises text/border contrast and thickens focus rings on top of the
// current theme (both light and dark) and complements the system-level
// `prefers-contrast: more` media query. Applied pre-paint in `main.tsx`.

import { readStorage, writeStorage } from "./storage";

export const CONTRAST_KEY = "folio.ui.contrast";
export const HIGH_CONTRAST_CLASS = "folio-high-contrast";

export type ContrastPref = "normal" | "high";

export function readContrastPref(): ContrastPref {
  return readStorage(CONTRAST_KEY) === "high" ? "high" : "normal";
}

/** Apply the class immediately (idempotent). */
export function applyContrastPref(pref: ContrastPref): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(HIGH_CONTRAST_CLASS, pref === "high");
}

/** Persist and apply; returns the normalized pref. */
export function setContrastPref(pref: ContrastPref): ContrastPref {
  writeStorage(CONTRAST_KEY, pref);
  applyContrastPref(pref);
  return pref;
}
