// F7 (Phase 5): folder import — turn one granted directory into the same
// `PickedFile[]` the single-file pickers produce, so the entire downstream
// pipeline (import queue, duplicate gate, progress, cancel) applies unchanged.
//
// The Rust folder picker grants the picked root this session; every
// `fs_list_dir`/`fs_stat`/`fs_read` below passes the path guard through that
// grant. Enumeration happens in TS because it only needs the guard-checked
// commands — no new Rust surface beyond the picker itself.
import type { FileStore } from "./fileStore";
import type { PickedFile } from "./fileSource";
import { reportError } from "./errorLog";

/** Mirrors Rust `pick.rs` BOOK_EXTENSIONS (pick.rs is the grant point). */
const IMPORT_EXTENSIONS = new Set(["epub", "html", "htm", "txt", "md", "pdf"]);

/** Walk budget: a bulk import of hundreds of books is legitimate; runaway
 * trees (e.g. a picked home directory) are not. */
export const MAX_FOLDER_FILES = 500;
export const MAX_WALK_DEPTH = 6;

/** Folders that are never book sources (app internals / VCS / system noise). */
const SKIPPED_DIRS = new Set([
  "$RECYCLE.BIN",
  "System Volume Information",
  "node_modules",
  ".git",
  ".svn",
  ".folio-library",
]);

export interface FolderScanResult {
  files: PickedFile[];
  /** Dirs or entries skipped and why — surfaced in the summary toast. */
  skippedCount: number;
  truncated: boolean;
}

export class FolderScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderScanError";
  }
}

function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Recursively list book/article files under `root` (already granted) and
 * return them as lazily-read picked files. A per-directory failure (unreadable
 * subdir, permission) is skipped and counted, never fatal; the guard rejecting
 * a path mid-walk is likewise a skip — the grant covers the picked root.
 */
export async function scanFolderForImport(
  fs: FileStore,
  root: string,
  limits: { maxFiles?: number; maxDepth?: number } = {},
): Promise<FolderScanResult> {
  const maxFiles = limits.maxFiles ?? MAX_FOLDER_FILES;
  const maxDepth = limits.maxDepth ?? MAX_WALK_DEPTH;

  const files: PickedFile[] = [];
  let skippedCount = 0;
  let truncated = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return;
    if (depth > maxDepth) {
      skippedCount += 1;
      return;
    }
    let entries;
    try {
      entries = await fs.list(dir);
    } catch (e) {
      reportError(e, "folderImport.list");
      skippedCount += 1;
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isDir) {
        const name = baseName(entry.path);
        if (SKIPPED_DIRS.has(name) || name.startsWith(".")) {
          skippedCount += 1;
          continue;
        }
        await walk(entry.path, depth + 1);
      } else if (IMPORT_EXTENSIONS.has(extensionOf(entry.path))) {
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        // Stat up front (like the single-file picker) so the queue's size
        // pre-check refuses oversized files before their bytes are read.
        let size: number | null = null;
        try {
          size = (await fs.stat(entry.path))?.size ?? null;
        } catch {
          // stat failure is not fatal — the queue re-checks on read anyway.
        }
        const path = entry.path;
        files.push({
          name: baseName(path),
          size,
          read: async () => fs.readBytes(path),
        });
      }
    }
  };

  await walk(root, 0);

  if (files.length === 0) {
    throw new FolderScanError(
      truncated
        ? "The selected folder holds too many files (over 500). Import it in parts."
        : "No importable books or articles were found in that folder.",
    );
  }
  return { files, skippedCount, truncated };
}
