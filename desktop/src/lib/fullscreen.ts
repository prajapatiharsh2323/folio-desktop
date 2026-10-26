// Fullscreen (F11 / 09 §5). In Tauri this is a native window state (the
// webview `requestFullscreen` cannot hide the OS title bar), and the reader
// gets the custom chrome automatically. Browser dev falls back to the DOM API.

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function markDom(fullscreen: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("folio-fullscreen", fullscreen);
}

export async function isFullscreen(): Promise<boolean> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().isFullscreen();
  }
  return typeof document !== "undefined" && !!document.fullscreenElement;
}

/** Toggle fullscreen and return the new state. */
export async function toggleFullscreen(): Promise<boolean> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const next = !(await win.isFullscreen());
    await win.setFullscreen(next);
    markDom(next);
    return next;
  }
  if (typeof document === "undefined") return false;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    markDom(false);
    return false;
  }
  await document.documentElement.requestFullscreen();
  markDom(true);
  return true;
}

/** Esc/F11 exit path. */
export async function exitFullscreen(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (await win.isFullscreen()) await win.setFullscreen(false);
    markDom(false);
    return;
  }
  if (typeof document !== "undefined" && document.fullscreenElement) {
    await document.exitFullscreen();
  }
  markDom(false);
}
