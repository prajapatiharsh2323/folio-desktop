// Drive mirror engine (05 §6). File-level newest-wins, user-list merges,
// docId remap, deletions never propagate, manifest uploaded last.
import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { sha256Hex } from "../lib/sha256";
import { LibraryManager } from "../store/libraryManager";
import { writeJsonAtomic } from "../store/jsonio";
import { nowIso } from "../model/ids";
import type { ManifestDoc } from "../model/types";
import { runExclusive } from "../lib/writeLock";
import { DriveClient, SyncFailure, type RemoteFile } from "./driveClient";
import { MERGEABLE_USER_FILES, mergeUserJsonFile } from "./merge";
import { readSyncState, writeSyncState, type SyncState } from "./state";

export interface SyncResult {
  pulled: number;
  pushed: number;
  merged: number;
  remapped: number;
  skipped: number;
}

export interface SyncContext {
  fs: FileStore;
  /** library root (`<appDir>/library`). */
  root: string;
  /** app dir containing `library/` and `sync/`. */
  appDir: string;
  onProgress?: (message: string) => void;
}

const MTIME_TOLERANCE_MS = 2000;
const MAX_DEPTH = 32;

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** All local files under the library root, excluding `index/` and temp files. */
export async function listLocalFiles(
  fs: FileStore,
  root: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (dir: string, prefix: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    const entries = await fs.list(dir);
    for (const entry of entries) {
      const name = basename(entry.path);
      if (!name || name.endsWith(".tmp")) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (entry.isDir) {
        if (rel === "index") continue; // search cache is device-local (05 §6)
        await walk(entry.path, rel, depth + 1);
      } else {
        out.set(rel, entry.path);
      }
    }
  };
  await walk(root, "", 0);
  return out;
}

/** Classify any thrown value into the mobile SyncFailure copy buckets. */
export function classifySyncError(error: unknown): SyncFailure {
  if (error instanceof SyncFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("AUTH:")) return new SyncFailure("AUTH", message.slice(5));
  if (message.startsWith("NETWORK:")) return new SyncFailure("NETWORK", message.slice(8));
  if (message.startsWith("DISK:")) return new SyncFailure("DISK", message.slice(5));
  if (message.startsWith("CONFLICT_FINAL:")) {
    return new SyncFailure("CONFLICT_FINAL", message.slice(15));
  }
  if (/network|failed to fetch|timeout|dns/i.test(message)) {
    return new SyncFailure("NETWORK", message);
  }
  if (/space|disk|EACCES|EPERM|EBUSY|locked|access is denied/i.test(message)) {
    return new SyncFailure("DISK", message);
  }
  return new SyncFailure("NETWORK", message);
}

async function recordLocal(
  fs: FileStore,
  state: SyncState,
  path: string,
  localPath: string,
  driveId: string,
  bytes: Uint8Array
): Promise<void> {
  const [sha256, stat] = await Promise.all([sha256Hex(bytes), fs.stat(localPath)]);
  state.files[path] = {
    driveId,
    sha256,
    mtimeMs: stat?.mtimeMs,
    size: bytes.length,
  };
}

/**
 * Re-key progress + annotations when the same book exists under two docIds.
 * First-imported id wins (05 §6.5). Collections/manifest are left untouched so
 * the dual-write invariant stays intact.
 */
export async function remapDocIds(fs: FileStore, root: string): Promise<{
  remaps: number;
  changedFiles: string[];
}> {
  const lm = new LibraryManager(fs, root);
  const manifest = await lm.load();
  if (!manifest || manifest.docs.length < 2) return { remaps: 0, changedFiles: [] };

  const byHash = new Map<string, ManifestDoc[]>();
  for (const doc of manifest.docs) {
    if (!doc.contentHash) continue;
    const group = byHash.get(doc.contentHash) ?? [];
    group.push(doc);
    byHash.set(doc.contentHash, group);
  }

  const progress = await lm.progress.all();
  const annotations = await lm.annotations.list();
  let remaps = 0;
  let progressChanged = false;
  let annotationsChanged = false;

  for (const group of byHash.values()) {
    if (group.length < 2) continue;

    // First-imported docId wins; fall back to slug/id for stable ordering.
    const rows = await Promise.all(
      group.map(async (doc) => ({
        doc,
        importedAt: (await lm.meta.read(doc.slug))?.importedAt ?? doc.updatedAt ?? "",
      }))
    );
    rows.sort(
      (a, b) => a.importedAt.localeCompare(b.importedAt) || a.doc.id.localeCompare(b.doc.id)
    );
    const winner = rows[0].doc;

    for (const { doc: loser } of rows.slice(1)) {
      if (loser.id === winner.id) continue;

      const loserProgress = progress[loser.id];
      if (loserProgress) {
        const current = progress[winner.id];
        const loserTime = Date.parse(loserProgress.updatedAt ?? "");
        const currentTime = Date.parse(current?.updatedAt ?? "");
        if (!current || !Number.isFinite(currentTime) || loserTime > currentTime) {
          progress[winner.id] = { ...loserProgress, docId: winner.id };
        }
        delete progress[loser.id];
        progressChanged = true;
      }

      for (const annotation of annotations) {
        if (annotation.docId === loser.id) {
          annotation.docId = winner.id;
          annotationsChanged = true;
        }
      }
      remaps++;
    }
  }

  const changedFiles: string[] = [];
  if (progressChanged) {
    await writeJsonAtomic(fs, L.progress(root), progress);
    changedFiles.push("user/progress.json");
  }
  if (annotationsChanged) {
    await lm.annotations.writeAll(annotations);
    changedFiles.push("user/annotations.json");
  }
  return { remaps, changedFiles };
}

async function pullAndMerge(
  client: DriveClient,
  ctx: SyncContext,
  remotes: Map<string, RemoteFile>,
  local: Map<string, string>,
  state: SyncState,
  forceUpload: Set<string>
): Promise<{ pulled: number; merged: number; manifestBytes: Uint8Array | null }> {
  const { fs } = ctx;
  let pulled = 0;
  let merged = 0;
  let manifestBytes: Uint8Array | null = null;

  for (const [path, remote] of remotes) {
    if (remote.isFolder || path.startsWith("index/")) continue;
    const localPath = local.get(path);

    if (!localPath) {
      const bytes = await client.download(remote.id);
      if (path === "manifest.json") {
        manifestBytes = bytes;
      } else {
        const abs = `${ctx.root}/${path}`;
        await fs.writeBytesAtomic(abs, bytes);
        await recordLocal(fs, state, path, abs, remote.id, bytes);
        pulled++;
      }
      continue;
    }

    if (MERGEABLE_USER_FILES.has(path)) {
      const localBytes = await fs.readBytes(localPath);
      const remoteBytes = await client.download(remote.id);
      const mergedBytes = mergeUserJsonFile(path, localBytes, remoteBytes);
      if (!sameBytes(mergedBytes, localBytes)) {
        await fs.writeBytesAtomic(localPath, mergedBytes);
        merged++;
        forceUpload.add(path);
      } else if (!sameBytes(mergedBytes, remoteBytes)) {
        // Remote has data the local file lacks; push the union.
        forceUpload.add(path);
      }
      continue;
    }

    const stat = await fs.stat(localPath);
    const saved = state.files[path];
    if (
      saved &&
      saved.driveId === remote.id &&
      stat &&
      saved.mtimeMs === stat.mtimeMs
    ) {
      continue;
    }

    const remoteTime = Date.parse(remote.modifiedTime) || 0;
    const localTime = stat?.mtimeMs ?? 0;
    if (remoteTime > localTime + MTIME_TOLERANCE_MS) {
      const bytes = await client.download(remote.id);
      if (path === "manifest.json") {
        manifestBytes = bytes;
      } else {
        await fs.writeBytesAtomic(localPath, bytes);
        await recordLocal(fs, state, path, localPath, remote.id, bytes);
        pulled++;
      }
    }
  }

  return { pulled, merged, manifestBytes };
}

async function pushLocal(
  client: DriveClient,
  ctx: SyncContext,
  rootId: string,
  remotes: Map<string, RemoteFile>,
  local: Map<string, string>,
  state: SyncState,
  forceUpload: Set<string>
): Promise<{ pushed: number; skipped: number }> {
  const { fs } = ctx;
  let pushed = 0;
  let skipped = 0;

  const paths = Array.from(local.keys()).sort((a, b) => {
    if (a === "manifest.json") return 1;
    if (b === "manifest.json") return -1;
    return a.localeCompare(b);
  });

  for (const path of paths) {
    if (path.startsWith("index/")) continue;
    const localPath = local.get(path)!;
    const remote = remotes.get(path);
    const saved = state.files[path];
    const stat = await fs.stat(localPath);
    const forced = forceUpload.has(path);

    if (
      !forced &&
      remote &&
      saved &&
      saved.driveId === remote.id &&
      stat &&
      saved.mtimeMs === stat.mtimeMs &&
      saved.sha256
    ) {
      skipped++;
      continue;
    }

    const bytes = await fs.readBytes(localPath);
    const sha256 = await sha256Hex(bytes);

    if (
      !forced &&
      remote &&
      saved &&
      saved.driveId === remote.id &&
      saved.sha256 === sha256
    ) {
      state.files[path] = { ...saved, mtimeMs: stat?.mtimeMs, size: bytes.length };
      skipped++;
      continue;
    }

    // Remote won during the pull pass; don't clobber it with this local copy.
    if (!forced && remote && stat) {
      const remoteTime = Date.parse(remote.modifiedTime) || 0;
      if (remoteTime > stat.mtimeMs + MTIME_TOLERANCE_MS) {
        skipped++;
        continue;
      }
    }

    const segments = path.split("/");
    const name = segments.pop()!;
    const parentId = await client.ensureFolderPath(rootId, segments);
    const uploaded = await client.upload(name, parentId, bytes, remote?.id);
    state.files[path] = {
      driveId: uploaded.id,
      sha256,
      mtimeMs: stat?.mtimeMs,
      size: bytes.length,
    };
    pushed++;
  }

  return { pushed, skipped };
}

/** Run one full bidirectional mirror. Throws SyncFailure on classified errors. */
export async function runSync(client: DriveClient, ctx: SyncContext): Promise<SyncResult> {
  // Serialize with import/annotations manifest rewrites (05 §4 invariant 4).
  return runExclusive(() => runSyncLocked(client, ctx));
}

async function runSyncLocked(client: DriveClient, ctx: SyncContext): Promise<SyncResult> {
  const { fs } = ctx;
  const report = ctx.onProgress ?? (() => {});

  report("Connecting to Drive…");
  const rootId = await client.ensureRootFolder();

  report("Comparing libraries…");
  const remotes = await client.listTree(rootId);
  const local = await listLocalFiles(fs, ctx.root);
  const state = await readSyncState(fs, ctx.appDir);
  const forceUpload = new Set<string>();

  const pull = await pullAndMerge(client, ctx, remotes, local, state, forceUpload);

  // The remote manifest is the pull commit point: write it after doc files.
  if (pull.manifestBytes) {
    const manifestPath = L.manifest(ctx.root);
    await fs.writeBytesAtomic(manifestPath, pull.manifestBytes);
    await recordLocal(fs, state, "manifest.json", manifestPath, remotes.get("manifest.json")!.id, pull.manifestBytes);
  }

  report("Merging annotations and progress…");
  const remap = await remapDocIds(fs, ctx.root);
  for (const changed of remap.changedFiles) forceUpload.add(changed);
  if (remap.remaps > 0) forceUpload.add("manifest.json");

  // Re-list after pulls/remap so newly written files are in the push set.
  const refreshedLocal = await listLocalFiles(fs, ctx.root);
  const push = await pushLocal(client, ctx, rootId, remotes, refreshedLocal, state, forceUpload);

  state.lastSyncAt = nowIso();
  await writeSyncState(fs, ctx.appDir, state);

  return {
    pulled: pull.pulled,
    pushed: push.pushed,
    merged: pull.merged,
    remapped: remap.remaps,
    skipped: push.skipped,
  };
}
