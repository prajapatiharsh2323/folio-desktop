import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initTheme, previewTheme, THEME_STORAGE_KEY, useThemeStore } from "./theme/theme";
import { showMainWindow } from "./lib/appWindow";
import { removeStorage } from "./lib/storage";
import {
  PREFS_COMPLETE_KEY,
  TOUR_COMPLETE_KEY,
  useOnboarding,
} from "./onboarding/onboardingState";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/reader.css";

// Apply the stored theme before React renders so a dark-mode launch never
// paints a light frame first. The window itself starts hidden (tauri.conf) and
// is shown once the first frame is ready.
initTheme();

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
  </React.StrictMode>
);

showMainWindow();
