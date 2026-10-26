// sync/state.json (05 §6): {path → {driveId, sha256}} for every mirrored path.
// `mtimeMs`/`size` are additive fields used to skip unchanged files without
// re-reading them; unknown keys are preserved.
import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { readJsonAsync, writeJsonAtomic } from "../store/jsonio";

export interface SyncStateEntry {
  driveId: string;
  sha256: string;
  /** Local mtime at the time of the last successful push/pull. */
  mtimeMs?: number;
  size?: number;
}

export interface SyncState {
  schema: 1;
  lastSyncAt?: string;
  files: Record<string, SyncStateEntry>;
}

export function emptyState(): SyncState {
  return { schema: 1, files: {} };
}

export async function readSyncState(fs: FileStore, appDir: string): Promise<SyncState> {
  const raw = await readJsonAsync<Partial<SyncState>>(fs, L.syncState(appDir));
  if (!raw || typeof raw !== "object") return emptyState();
  return {
    schema: 1,
    lastSyncAt: typeof raw.lastSyncAt === "string" ? raw.lastSyncAt : undefined,
    files: raw.files && typeof raw.files === "object" ? raw.files : {},
  };
}

export async function writeSyncState(
  fs: FileStore,
  appDir: string,
  state: SyncState
): Promise<void> {
  await writeJsonAtomic(fs, L.syncState(appDir), state);
}
