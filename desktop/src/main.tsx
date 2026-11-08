import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initTheme } from "./theme/theme";
import { showMainWindow } from "./lib/appWindow";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/reader.css";

// Apply the stored theme before React renders so a dark-mode launch never
// paints a light frame first. The window itself starts hidden (tauri.conf) and
// is shown once the first frame is ready.
initTheme();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

showMainWindow();
