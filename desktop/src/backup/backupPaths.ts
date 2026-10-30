// Archive path policy for backup restore.
//
// Restore writes into the library tree, so entry names are untrusted input.
// Rules are deliberately stricter than the schema needs: a backup produced by
// Folio only ever contains `manifest.json`, `docs/**`, `user/**`, `index/**`
// and a root `backup.json`.

import { BackupError, BACKUP_META_NAME, MANIFEST_NAME, type ArchiveLimits } from "./backupSchema";

export type ArchiveEntryKind = "library" | "derived" | "metadata";

export interface NormalizedEntry {
  /** Name as stored in the ZIP (diagnostics only). */
  raw: string;
  /** Forward-slash path, safe to append to a library root. */
  path: string;
  kind: ArchiveEntryKind;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Normalize and validate one archive entry name. Throws BackupError. */
export function normalizeArchivePath(raw: string, limits: ArchiveLimits): string {
  const unsafe = (reason: string): never => {
    throw new BackupError(
      "unsafe-path",
      `The backup contains an unsafe path: ${reason}`,
      raw
    );
  };

  if (typeof raw !== "string" || raw.length === 0) unsafe("empty name");
  if (raw.length > limits.maxPathLength) unsafe("name is too long");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) unsafe("control characters");
  if (raw.includes("\u0000")) unsafe("NUL byte");

  // ZIPs in the wild use both separators; normalize before validating.
  const slashed = raw.replace(/\\/g, "/");
  if (slashed.startsWith("/")) unsafe("absolute path");
  if (slashed.startsWith("//")) unsafe("UNC path");
  if (/^[a-zA-Z]:/.test(slashed)) unsafe("drive-letter path");
  if (slashed.endsWith("/")) unsafe("directory entry used as a file");

  const segments = slashed.split("/");
  if (segments.length > limits.maxDepth) unsafe("path is nested too deeply");

  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      unsafe("empty or relative segment");
    }
    if (/[. ]$/.test(segment)) unsafe("trailing dot or space");
    if (WINDOWS_RESERVED.test(segment)) unsafe("reserved Windows name");
    if (segment.length > 255) unsafe("segment is too long");
  }

  return segments.join("/");
}

/** Classify a normalized path; `null` means the archive is not a Folio backup. */
export function classifyArchivePath(path: string): ArchiveEntryKind | null {
  if (path === MANIFEST_NAME) return "library";
  if (path === BACKUP_META_NAME) return "metadata";
  // OS junk is ignored rather than rejected so a folder browsed in Explorer
  // can still be backed up.
  const name = path.split("/").pop() ?? "";
  if (name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini") {
    return "derived";
  }
  if (path.startsWith("__MACOSX/")) return "derived";
  if (path.startsWith("index/")) return "derived";
  if (path.startsWith("docs/")) {
    // docs/<slug>/<file> or deeper; a bare docs/<slug> file is malformed.
    return path.split("/").length >= 3 ? "library" : null;
  }
  if (path.startsWith("user/")) {
    return path.split("/").length >= 2 ? "library" : null;
  }
  return null;
}

/** Validate + classify, or reject the entry. */
export function normalizeEntry(raw: string, limits: ArchiveLimits): NormalizedEntry {
  const path = normalizeArchivePath(raw, limits);
  const kind = classifyArchivePath(path);
  if (!kind) {
    throw new BackupError(
      "invalid-library",
      `The backup contains an unexpected file: ${path}`,
      path
    );
  }
  return { raw, path, kind };
}

/**
 * Reject case-insensitive duplicates. Windows restores two differently-cased
 * names into the same file, which would silently drop data.
 */
export function assertNoDuplicatePaths(
  entries: { path: string }[]
): void {
  const seen = new Map<string, string>();
  for (const e of entries) {
    const key = e.path.toLowerCase();
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new BackupError(
        "duplicate-path",
        "The backup contains duplicate file names that differ only by case.",
        `${previous} / ${e.path}`
      );
    }
    seen.set(key, e.path);
  }
}
