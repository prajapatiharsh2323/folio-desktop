// X1 (Phase 4): "Reopen last book on launch".
//
// The preference lives in the desktop-only user/window.json
// (`reopenLastBook`, default off — launching into a book is opt-in). At boot
// the newest progress record wins (progress.json holds one record per doc,
// keyed by docId, ISO timestamps sort lexicographically); the doc must still
// exist in the manifest, and opening happens through the same openReader
// request the library rows use, so the resume cascade applies unchanged.

import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { readJsonAsync, writeJsonAtomic } from "../store/jsonio";
import type { Manifest, Progress } from "../model/types";
import { useRouteStore } from "../store/routeStore";

export async function readReopenLastSetting(fs: FileStore, appDir: string): Promise<boolean> {
  const raw = await readJsonAsync<{ reopenLastBook?: unknown }>(fs, `${appDir}/user/window.json`);
  return raw?.reopenLastBook === true;
}

export async function writeReopenLastSetting(
  fs: FileStore,
  appDir: string,
  enabled: boolean,
): Promise<void> {
  const path = `${appDir}/user/window.json`;
  const raw = await readJsonAsync<Record<string, unknown>>(fs, path);
  await writeJsonAtomic(fs, path, { ...(raw ?? {}), reopenLastBook: enabled });
}

/** The docId of the most recently read book, or null when nothing was read. */
export function pickLastReadDoc(progress: Record<string, Progress>): string | null {
  let best: Progress | null = null;
  for (const record of Object.values(progress)) {
    if (!record || typeof record.docId !== "string") continue;
    if (!best || (record.updatedAt ?? "") > (best.updatedAt ?? "")) best = record;
  }
  return best?.docId ?? null;
}

/**
 * Reopen the last-read book at its saved position. Quiet no-op when the
 * setting is off, nothing was ever read, or the doc is gone from the
 * manifest. In browser mode the reader route is still set (the in-app
 * reader works there); the Tauri invoke branch is only for future use.
 */
export async function reopenLastBookIfEnabled(
  fs: FileStore,
  appDir: string,
  libraryRoot: string,
): Promise<boolean> {
  if (!(await readReopenLastSetting(fs, appDir))) return false;
  const progress = await readJsonAsync<Record<string, Progress>>(fs, L.progress(libraryRoot));
  if (!progress) return false;
  const docId = pickLastReadDoc(progress);
  if (!docId) return false;
  const manifest = await readJsonAsync<Manifest>(fs, L.manifest(libraryRoot));
  if (!manifest?.docs?.some((d) => d.id === docId)) return false;

  const record = progress[docId];
  useRouteStore.getState().openReader({
    docId,
    location: record?.location || null,
    percent: typeof record?.percent === "number" ? record.percent : null,
  });
  return true;
}
