// S1 (Phase 4): UI zoom — 80–150% applies as CSS zoom on the document root
// and persists in localStorage so the choice survives restarts.
//
// The setting scales the app chrome (and flowing content); it is separate
// from the reader's own font-size prefs. `zoom` is supported by the
// WebView2 host (Chromium) and degrades to a no-op visual in browsers
// without it.

import { readStorage, writeStorage } from "./storage";

export const UI_ZOOM_KEY = "folio.ui.zoom";
export const UI_ZOOM_MIN = 80;
export const UI_ZOOM_MAX = 150;

export const UI_ZOOM_STEPS = [80, 90, 100, 110, 125, 150] as const;

/** Clamp a percent into the supported range (100 default). */
export function clampUiZoom(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  const whole = Math.round(percent);
  if (whole < UI_ZOOM_MIN) return UI_ZOOM_MIN;
  if (whole > UI_ZOOM_MAX) return UI_ZOOM_MAX;
  return whole;
}

/** Stored zoom percent, clamped (100 when unset or unparseable). */
export function readUiZoom(): number {
  const raw = readStorage(UI_ZOOM_KEY);
  if (raw === null || raw === "") return 100;
  const n = Number(raw);
  return Number.isFinite(n) ? clampUiZoom(n) : 100;
}

/** Persist and apply immediately; empty string at 100 clears the override. */
export function applyUiZoom(percent: number): number {
  const pct = clampUiZoom(percent);
  writeStorage(UI_ZOOM_KEY, String(pct));
  if (typeof document !== "undefined") {
    document.documentElement.style.zoom = pct === 100 ? "" : String(pct / 100);
  }
  return pct;
}
