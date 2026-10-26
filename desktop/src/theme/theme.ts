import { create } from "zustand";

export type ThemeSetting = "light" | "dark" | "system";

const STORAGE_KEY = "folio.theme-setting";

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
  const resolved = resolveTheme(setting);
  document.documentElement.dataset.theme = resolved;
}

function readStoredSetting(): ThemeSetting {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export const useThemeStore = create<ThemeState>((set) => ({
  setting: readStoredSetting(),
  setSetting: (setting) => {
    try {
      localStorage.setItem(STORAGE_KEY, setting);
    } catch {
      /* storage unavailable — session-only */
    }
    applyTheme(setting);
    set({ setting });
  },
}));

let media: MediaQueryList | null = null;
let mediaHandler: (() => void) | null = null;

/** Initialize theme: apply stored setting and follow OS changes while on "system". */
export function initTheme(): void {
  const setting = readStoredSetting();
  applyTheme(setting);
  useThemeStore.setState({ setting });

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    mediaHandler = () => {
      if (useThemeStore.getState().setting === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener?.("change", mediaHandler);
  }
}

export function disposeTheme(): void {
  if (media && mediaHandler) media.removeEventListener?.("change", mediaHandler);
  media = null;
  mediaHandler = null;
}
