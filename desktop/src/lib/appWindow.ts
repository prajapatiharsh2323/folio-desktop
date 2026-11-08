// Show the shell after the first frame. The window starts hidden so WebView2
// cannot paint white before the theme is applied; Rust also has a 1.5 s
// fallback in case the frontend never reaches this code.
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function showMainWindow(): void {
  if (!isTauri()) return;
  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().show())
      .catch(() => {
        /* Rust fallback still reveals the window */
      });
  };

  // Two frames: the first commits the tree, the second lands after paint.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(show));
  } else {
    setTimeout(show, 0);
  }
  // Frontend-side safety net when the webview is alive but rAF is throttled.
  setTimeout(show, 1500);
}
