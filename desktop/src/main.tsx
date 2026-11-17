import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initTheme, previewTheme, THEME_STORAGE_KEY, useThemeStore } from "./theme/theme";
import { showMainWindow } from "./lib/appWindow";
import { installGlobalErrorHandlers } from "./lib/errorLog";
import { removeStorage } from "./lib/storage";
import { applyUiZoom, readUiZoom } from "./lib/uiZoom";
import { applyContrastPref, readContrastPref } from "./lib/highContrast";
import { initLocale } from "./i18n/i18n";
import { initSyncedPrefs, mirrorStorageChange } from "./lib/syncedPrefs";
import { setStorageMirror } from "./lib/storage";
import { getLibraryFs, LIBRARY_ROOT } from "./store/libraryUi";
import { PREFS_COMPLETE_KEY, TOUR_COMPLETE_KEY, useOnboarding } from "./onboarding/onboardingState";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/reader.css";
import "./styles/pdf.css";
// Apply the stored theme before React renders so a dark-mode launch never
// paints a light frame first. The window itself starts hidden (tauri.conf) and
// is shown once the first frame is ready.
initTheme();

// S1: apply the persisted UI zoom (80–150%) before the first paint too.
applyUiZoom(readUiZoom());

// X3: opt-in high-contrast mode, also applied pre-paint.
applyContrastPref(readContrastPref());

// X5: app locale — sets `lang`/`dir` on <html> before the first paint (RTL
// scripts must not paint an LTR frame first).
initLocale();

// E7: mirror synced appearance keys into user/window.json (the backup ships
// user/**) so a restored backup on a fresh machine brings its settings back.
initSyncedPrefs({
  fs: getLibraryFs(),
  appDir: LIBRARY_ROOT.replace(/[\\/]+library[\\/]*$/, "") || LIBRARY_ROOT,
});
setStorageMirror(mirrorStorageChange);

// Keep a local, rotating diagnostic trail; nothing leaves the machine.
installGlobalErrorHandlers();

// Dev-only: replay first-run setup without clearing the library.
if (import.meta.env.DEV) {
  window.__folioResetOnboarding = () => {
    removeStorage(PREFS_COMPLETE_KEY);
    removeStorage(TOUR_COMPLETE_KEY);
    removeStorage(THEME_STORAGE_KEY);
    useThemeStore.setState({ setting: "system" });
    previewTheme("system");
    useOnboarding.getState().refresh();
  };
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

showMainWindow();
