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
}

export function removeStorage(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}
