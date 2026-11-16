// X1 (Phase 4): the OS window title tracks the open book.
//
// The document title is set in every host; in Tauri the native window title is
// updated too (`core:window:allow-set-title` was granted in Phase 1 E3).
// Title updates are cosmetic — a failing native call must never break the
// caller, so every error is swallowed.

import { isTauri } from "../reader/keepAwake";

export const APP_WINDOW_TITLE = "Folio";

export function bookWindowTitle(bookTitle: string): string {
  return bookTitle ? `${bookTitle} — Folio` : APP_WINDOW_TITLE;
}

export async function setWindowTitle(title: string): Promise<void> {
  if (typeof document !== "undefined") document.title = title;
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } catch {
    // cosmetic only
  }
}
