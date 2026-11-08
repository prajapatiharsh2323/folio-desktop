import { create } from "zustand";
import { readStorage, writeStorage } from "../lib/storage";

export type ThemeSetting = "light" | "dark" | "system";

const STORAGE_KEY = "folio.theme-setting";
export const THEME_STORAGE_KEY = STORAGE_KEY;

interface ThemeState {
  setting: ThemeSetting;
  setSetting: (s: ThemeSetting) => void;
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolveTheme(setting: ThemeSetting): "light" | "dark" {
  if (setting === "system") return systemPrefersDark() ? "dark" : "light";
  return setting;
}

function applyTheme(setting: ThemeSetting): void {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(setting);
  document.documentElement.dataset.theme = resolved;
}

function readStoredSetting(): ThemeSetting {
  const v = readStorage(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export const useThemeStore = create<ThemeState>((set) => ({
  setting: readStoredSetting(),
  setSetting: (setting) => {
    writeStorage(STORAGE_KEY, setting);
    applyTheme(setting);
    set({ setting });
  },
}));

/**
 * Apply a theme without persisting it (first-run setup preview). Pass `null` to
 * restore whatever the saved setting is.
 */
export function previewTheme(setting: ThemeSetting | null): void {
  applyTheme(setting ?? useThemeStore.getState().setting);
}

let media: MediaQueryList | null = null;
let mediaHandler: (() => void) | null = null;

/**
 * Initialize theme: apply the stored setting and follow OS changes while on
 * "system". Returns a cleanup so React StrictMode's mount/unmount/mount cycle
 * never leaves two listeners behind.
 */
export function initTheme(): () => void {
  const setting = readStoredSetting();
  applyTheme(setting);
  useThemeStore.setState({ setting });

  const detach = () => {
    if (media && mediaHandler) media.removeEventListener?.("change", mediaHandler);
    media = null;
    mediaHandler = null;
  };
  // Defensive: a previous init that was never cleaned up must not stack.
  detach();

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (useThemeStore.getState().setting === "system") {
        applyTheme("system");
      }
    };
    query.addEventListener?.("change", handler);
    media = query;
    mediaHandler = handler;
    return () => {
      if (media === query && mediaHandler === handler) detach();
      else query.removeEventListener?.("change", handler);
    };
  }

  return () => {};
}
