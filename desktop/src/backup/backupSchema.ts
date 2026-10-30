// Backup archive metadata + limits (02 §5, 05 §2).
//
// A Folio backup is a ZIP of the library tree plus a root `backup.json` that
// names the format and pins the manifest hash. Schema 2 adds counts and a size
// total so restore can preflight before touching the live library; schema 1
// archives written by earlier builds remain readable.

export const APP_VERSION = "0.1.0";
export const BACKUP_SCHEMA = 2;
export const BACKUP_META_NAME = "backup.json";
export const MANIFEST_NAME = "manifest.json";

export interface ArchiveLimits {
  /** Compressed archive ceiling. */
  maxCompressedBytes: number;
  /** Entry count ceiling (directories included, though they are skipped). */
  maxEntries: number;
  /** Single expanded entry ceiling. */
  maxEntryBytes: number;
  /** Sum of declared expanded sizes. */
  maxTotalBytes: number;
  /** Path segment depth (e.g. docs/slug/reading/book.epub = 5). */
  maxDepth: number;
  /** Path length in characters. */
  maxPathLength: number;
  /** `backup.json` / `manifest.json` ceiling. */
  maxMetadataBytes: number;
}

export const BACKUP_LIMITS: ArchiveLimits = {
  maxCompressedBytes: 2 * 1024 * 1024 * 1024,
  maxEntries: 20_000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  maxDepth: 12,
  maxPathLength: 200,
  maxMetadataBytes: 1024 * 1024,
};

export type BackupErrorCode =
  | "not-zip"
  | "corrupt"
  | "unsupported-schema"
  | "invalid-metadata"
  | "missing-manifest"
  | "hash-mismatch"
  | "unsafe-path"
  | "duplicate-path"
  | "too-large"
  | "too-many-entries"
  | "invalid-library"
  | "missing-file"
  | "zlib64"
  | "staging"
  | "rollback";

/** Every failure surfaced to the user carries a stable code for tests/copy. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = "BackupError";
  }
}

export interface BackupMetaV2 {
  schema: 2;
  app: "folio";
  createdAt: string;
  appVersion: string;
  libraryId?: string;
  manifestSha256: string;
  docCount: number;
  fileCount: number;
  uncompressedBytes: number;
}

/** Archive metadata written before schema 2 (counts unknown). */
export interface BackupMetaV1 {
  schema: 1;
  app: "folio";
  createdAt: string;
  manifestSha256: string;
}

export type BackupMeta = BackupMetaV1 | BackupMetaV2;

export function parseBackupMeta(bytes: Uint8Array): BackupMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BackupError(
      "invalid-metadata",
      "This backup's backup.json is not valid JSON."
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BackupError("invalid-metadata", "This backup's backup.json is malformed.");
  }
  const o = raw as Record<string, unknown>;
  if (o.app !== "folio") {
    throw new BackupError("invalid-metadata", "This ZIP is not a Folio backup.");
  }
  if (typeof o.schema !== "number") {
    throw new BackupError("invalid-metadata", "This backup has no format version.");
  }
  if (o.schema > BACKUP_SCHEMA) {
    throw new BackupError(
      "unsupported-schema",
      `This backup was made by a newer version of Folio (schema ${String(
        o.schema
      )}). Update Folio before restoring it.`
    );
  }
  if (o.schema !== 1 && o.schema !== 2) {
    throw new BackupError(
      "unsupported-schema",
      `Backup schema ${String(o.schema)} is not supported.`
    );
  }
  const sha = typeof o.manifestSha256 === "string" ? o.manifestSha256 : "";
  if (o.schema === 1) {
    return {
      schema: 1,
      app: "folio",
      createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
      manifestSha256: sha,
    };
  }
  const docCount = typeof o.docCount === "number" ? o.docCount : -1;
  const fileCount = typeof o.fileCount === "number" ? o.fileCount : -1;
  const uncompressedBytes =
    typeof o.uncompressedBytes === "number" ? o.uncompressedBytes : -1;
  if (docCount < 0 || fileCount < 0 || uncompressedBytes < 0) {
    throw new BackupError("invalid-metadata", "This backup's metadata is incomplete.");
  }
  return {
    schema: 2,
    app: "folio",
    createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    appVersion: typeof o.appVersion === "string" ? o.appVersion : "",
    libraryId: typeof o.libraryId === "string" ? o.libraryId : undefined,
    manifestSha256: sha,
    docCount,
    fileCount,
    uncompressedBytes,
  };
}

export function encodeBackupMeta(meta: BackupMetaV2): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(meta));
}
