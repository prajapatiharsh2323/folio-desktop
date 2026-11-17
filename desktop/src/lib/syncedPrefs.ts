// E7 (Phase 4 Step 4.5): backed-up appearance preferences.
//
// Theme, UI zoom, contrast, locale, default library sort/view live in
// localStorage — which is NOT part of a backup — while `user/window.json`
// IS (the archive ships `user/**`). Every `writeStorage` of a synced key is
// therefore mirrored into `user/window.json` (additive, unknown keys
// preserved, debounced), and boot restores any synced key the local store
// lacks — so restoring a backup on a fresh machine brings the appearance
// settings back.
import type { FileStore } from "./fileStore";
import { readStorage, writeStorage } from "./storage";
import { readJsonAsync, writeJsonAtomic } from "../store/jsonio";
import { readUiZoom, applyUiZoom } from "./uiZoom";
import { readContrastPref, applyContrastPref } from "./highContrast";
import { readStoredLocale, applyLocale } from "../i18n/i18n";

const WINDOW_FILE = "user/window.json";

/** localStorage keys mirrored into the backed-up settings file. */
const SYNCED_KEYS: ReadonlySet<string> = new Set([
  "folio.theme-setting",
  "folio.library.sort",
  "folio.library.view",
  "folio.ui.zoom",
  "folio.ui.contrast",
  "folio.ui.locale",
]);

export interface SyncedPrefsHost {
  fs: FileStore;
  appDir: string;
}

let host: SyncedPrefsHost | null = null;
let pending: Map<string, string | null> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Set once at boot with the resolved file store + app dir. */
export function initSyncedPrefs(h: SyncedPrefsHost): void {
  host = h;
}

/** storage-mirror hook: called by lib/storage on every write/remove. */
export function mirrorStorageChange(key: string, value: string | null): void {
  if (!host || !SYNCED_KEYS.has(key)) return;
  pending ??= new Map();
  pending.set(key, value);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const batch = pending;
    pending = null;
    void flush(batch!);
  }, 500);
}

async function flush(batch: Map<string, string | null>): Promise<void> {
  const target = host!;
  const path = `${target.appDir}/${WINDOW_FILE}`;
  try {
    const current = (await readJsonAsync<Record<string, unknown>>(target.fs, path)) ?? {};
    let changed = false;
    for (const [key, value] of batch) {
      if (value === null) {
        if (key in current) {
          delete current[key];
          changed = true;
        }
      } else if (current[key] !== value) {
        current[key] = value;
        changed = true;
      }
    }
    if (changed) await writeJsonAtomic(target.fs, path, current);
  } catch {
    // Mirroring must never break the write that triggered it.
  }
}

/**
 * Boot restore: for every synced key present in the backed-up file but
 * missing from the local store (fresh machine after a restore), write it
 * back and re-apply. Returns the keys that were applied.
 */
export async function restoreSyncedPrefs(): Promise<string[]> {
  if (!host) return [];
  const { fs, appDir } = host;
  const raw = await readJsonAsync<Record<string, unknown>>(fs, `${appDir}/${WINDOW_FILE}`);
  if (!raw) return [];
  const applied: string[] = [];
  for (const key of SYNCED_KEYS) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    if (readStorage(key) === null) {
      writeStorage(key, value);
      applied.push(key);
    }
  }
  if (applied.length === 0) return applied;

  // Re-apply the synced keys that paint the UI; each helper is idempotent
  // and none registers listeners (unlike initTheme).
  for (const key of applied) {
    if (key === "folio.ui.zoom") applyUiZoom(readUiZoom());
    else if (key === "folio.ui.contrast") applyContrastPref(readContrastPref());
    else if (key === "folio.ui.locale") applyLocale(readStoredLocale());
  }
  return applied;
}

/** Test helper: drop a mirror scheduled before an interruption. */
export function resetSyncedPrefsForTest(): void {
  host = null;
  pending = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
