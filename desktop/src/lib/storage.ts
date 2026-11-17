// Safe Web Storage access. localStorage throws in some privacy modes and is
// absent during SSR; every read/write in the app goes through these helpers so
// a blocked store degrades to in-memory defaults instead of taking a screen
// down.
//
// `window.localStorage` is checked first: some runtimes expose a disabled
// global `localStorage` binding while the jsdom window still has a usable one.

function storage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    /* access can throw when storage is blocked */
  }
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch {
    /* access can throw when storage is blocked */
  }
  return null;
}

export function readStorage(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    /* storage unavailable — session-only */
  }
  mirror?.(key, value);
}

export function removeStorage(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* storage unavailable */
  }
  mirror?.(key, null);
}

/**
 * Optional change observer for E7's synced-prefs mirror. Set once at boot
 * (main.tsx) so selected user-facing keys also land in the backed-up
 * `user/window.json`; `null` clears it. Never called for unrelated keys
 * unless the observer decides — the mirror filters.
 */
type StorageMirror = (key: string, value: string | null) => void;
let mirror: StorageMirror | null = null;

export function setStorageMirror(fn: StorageMirror | null): void {
  mirror = fn;
}
