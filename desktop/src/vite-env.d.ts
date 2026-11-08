/// <reference types="vite/client" />

/** Injected by Vite from desktop/package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;

interface Window {
  /** Dev-only helper: clear setup flags and stored theme, then show step 1. */
  __folioResetOnboarding?: () => void;
}

