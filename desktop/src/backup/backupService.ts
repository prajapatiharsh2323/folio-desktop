// Backup export + validated restore (02 §5, 05 §4).
//
// Restore is a staged transaction:
//   1. read the ZIP directory and reject unsafe names/sizes before expanding;
//   2. expand into a sibling staging directory;
//   3. validate manifest, doc metadata, file hashes and user JSON;
//   4. replace = swap staging with the live root, keeping a rollback copy;
//      merge = add missing docs and union user data by record identity;
//   5. write the manifest last, then rebuild the derived search index.
//
// Nothing under the live root is mutated before step 3 succeeds.

import { zipSync } from "fflate";
import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { sha256Hex } from "../lib/sha256";
import { newUuid, nowIso } from "../model/ids";
import type {
  Annotation,
  Collection,
  DocMeta,
  Manifest,
  Progress,
} from "../model/types";
import { LibraryManager } from "../store/libraryManager";
import { readJsonAsync, writeJsonAtomic } from "../store/jsonio";
import {
  APP_VERSION,
  BACKUP_LIMITS,
  BACKUP_META_NAME,
  BACKUP_SCHEMA,
  BackupError,
  MANIFEST_NAME,
  encodeBackupMeta,
  parseBackupMeta,
  type ArchiveLimits,
  type BackupMetaV2,
} from "./backupSchema";
import {
  assertNoDuplicatePaths,
  normalizeEntry,
  type ArchiveEntryKind,
} from "./backupPaths";
import { readCentralDirectory, readEntryData, type ZipEntry } from "./zipArchive";
import { reindexDocs, type ReindexFailure } from "./reindex";

export interface BackupSummary {
  schema: 1 | 2;
  createdAt: string;
  appVersion: string;
  docCount: number;
  fileCount: number;
  uncompressedBytes: number;
  legacy: boolean;
  warnings: string[];
}

export type RestorePhase =
  | "reading"
  | "extracting"
  | "validating"
  | "applying"
  | "indexing"
  | "done";

export interface SkippedDoc {
  title: string;
  reason: string;
}

export interface RestoreResult {
  mode: "merge" | "replace";
  addedDocs: number;
  skippedDocs: SkippedDoc[];
  conflicts: number;
  annotationsMerged: number;
  progressMerged: number;
  collectionsMerged: number;
  reindexed: number;
  reindexFailures: ReindexFailure[];
  warnings: string[];
}

interface NormalizedZipEntry {
  entry: ZipEntry;
  path: string;
  kind: ArchiveEntryKind;
}

interface ParsedArchive {
  entries: NormalizedZipEntry[];
  meta: ReturnType<typeof parseBackupMeta>;
  manifest: Manifest;
  summary: BackupSummary;
}

function readable(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "";
}

/** Parent of the library root; staging lives beside it so renames stay on one volume. */
export function workspaceOf(root: string): string {
  const clean = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const cut = clean.lastIndexOf("/");
  return cut <= 0 ? "/" : clean.slice(0, cut);
}

function isJunkName(name: string): boolean {
  return name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini";
}

async function treeExists(fs: FileStore, path: string): Promise<boolean> {
  if (await fs.stat(path)) return true;
  return (await fs.list(path)).length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new BackupError("invalid-library", `The backup's ${what} is malformed.`);
  }
  return value;
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BackupError("invalid-library", `The backup is missing ${what}.`);
  }
  return value;
}

function validateManifestShape(raw: unknown): Manifest {
  const o = requireRecord(raw, "manifest.json");
  if (o.schema !== 1 || o.app !== "folio") {
    throw new BackupError("invalid-library", "The backup's manifest.json is not a Folio manifest.");
  }
  if (!Array.isArray(o.docs)) {
    throw new BackupError("invalid-library", "The backup's manifest has no document list.");
  }
  for (const d of o.docs) {
    const doc = requireRecord(d, "manifest entry");
    requireString(doc.id, "a document id");
    requireString(doc.slug, "a document folder name");
    requireString(doc.contentHash, "a document content hash");
    if (!Array.isArray(doc.files)) {
      throw new BackupError("invalid-library", "A document in the backup has no file list.");
    }
    for (const f of doc.files) {
      const file = requireRecord(f, "manifest file entry");
      requireString(file.path, "a manifest file path");
    }
  }
  return o as unknown as Manifest;
}

function parseManifestBytes(bytes: Uint8Array): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BackupError("invalid-library", "The backup's manifest.json is not valid JSON.");
  }
  return validateManifestShape(raw);
}

/** Read JSON, distinguishing "missing" (undefined) from "corrupt" (throws). */
async function readOptionalJson(fs: FileStore, path: string): Promise<unknown> {
  if (!(await fs.exists(path))) return undefined;
  const text = await fs.readText(path);
  try {
    return JSON.parse(text);
  } catch {
    throw new BackupError(
      "invalid-library",
      `The backup's ${basename(path)} is not valid JSON.`
    );
  }
}

function asArray(value: unknown, what: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new BackupError("invalid-library", `The backup's ${what} is malformed.`);
  }
  return value;
}

function asRecordMap(value: unknown, what: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new BackupError("invalid-library", `The backup's ${what} is malformed.`);
  }
  return value;
}

function newest(a: { updatedAt?: unknown }, b: { updatedAt?: unknown }): boolean {
  const au = typeof a.updatedAt === "string" ? a.updatedAt : "";
  const bu = typeof b.updatedAt === "string" ? b.updatedAt : "";
  return au > bu;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function createBackup(
  fs: FileStore,
  root: string,
  limits: ArchiveLimits = BACKUP_LIMITS
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let total = 0;

  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const e of await fs.list(dir)) {
      const name = basename(e.path);
      if (!name) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      if (e.isDir) {
        // Derived index text is rebuilt after restore.
        if (childRel === "index") continue;
        await walk(e.path, childRel);
        continue;
      }
      if (childRel === "index" || childRel.startsWith("index/")) continue;
      if (childRel === BACKUP_META_NAME || name.endsWith(".tmp")) continue;
      if (isJunkName(name)) continue;
      const bytes = await fs.readBytes(e.path);
      total += bytes.length;
      if (total > limits.maxTotalBytes) {
        throw new BackupError(
          "too-large",
          "This library is too large for a single backup archive."
        );
      }
      files[childRel] = bytes;
    }
  };

  await walk(root, "");
  const manifestBytes = files[MANIFEST_NAME];
  if (!manifestBytes) {
    throw new BackupError(
      "missing-manifest",
      "Your library has no manifest, so it cannot be backed up. Repair the library first."
    );
  }
  const manifest = parseManifestBytes(manifestBytes);
  const meta: BackupMetaV2 = {
    schema: BACKUP_SCHEMA,
    app: "folio",
    createdAt: nowIso(),
    appVersion: APP_VERSION,
    libraryId: typeof manifest.libraryId === "string" ? manifest.libraryId : undefined,
    manifestSha256: await sha256Hex(manifestBytes),
    docCount: manifest.docs.length,
    fileCount: Object.keys(files).length,
    uncompressedBytes: total,
  };
  files[BACKUP_META_NAME] = encodeBackupMeta(meta);

  const zipped = zipSync(files);
  if (zipped.length > limits.maxCompressedBytes) {
    throw new BackupError("too-large", "The backup archive would be too large to restore safely.");
  }
  return zipped;
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

async function readArchive(
  bytes: Uint8Array,
  limits: ArchiveLimits
): Promise<ParsedArchive> {
  const zipEntries = readCentralDirectory(bytes, limits);
  const entries: NormalizedZipEntry[] = [];
  for (const entry of zipEntries) {
    if (entry.name.endsWith("/")) continue;
    const norm = normalizeEntry(entry.name, limits);
    entries.push({ entry, path: norm.path, kind: norm.kind });
  }
  assertNoDuplicatePaths(entries);

  const metaEntry = entries.find((e) => e.path === BACKUP_META_NAME);
  if (!metaEntry) {
    throw new BackupError(
      "invalid-metadata",
      "This ZIP is not a Folio backup (backup.json is missing)."
    );
  }
  const metaBytes = readEntryData(bytes, metaEntry.entry, limits);
  if (metaBytes.length > limits.maxMetadataBytes) {
    throw new BackupError("invalid-metadata", "This backup's metadata is too large.");
  }
  const meta = parseBackupMeta(metaBytes);

  const manifestEntry = entries.find((e) => e.path === MANIFEST_NAME);
  if (!manifestEntry) {
    throw new BackupError("missing-manifest", "This backup has no manifest.json.");
  }
  const manifestBytes = readEntryData(bytes, manifestEntry.entry, limits);
  if (manifestBytes.length > limits.maxMetadataBytes) {
    throw new BackupError("invalid-library", "This backup's manifest is too large.");
  }
  const manifest = parseManifestBytes(manifestBytes);
  if (meta.manifestSha256) {
    const actual = await sha256Hex(manifestBytes);
    if (actual !== meta.manifestSha256) {
      throw new BackupError(
        "hash-mismatch",
        "This backup is damaged: its manifest does not match the recorded checksum."
      );
    }
  }

  const libraryEntries = entries.filter((e) => e.kind === "library");
  const declaredBytes = libraryEntries.reduce(
    (sum, e) => sum + e.entry.uncompressedSize,
    0
  );
  if (meta.schema === 2) {
    if (meta.docCount !== manifest.docs.length) {
      throw new BackupError("invalid-metadata", "This backup's document count does not match its manifest.");
    }
    if (meta.fileCount !== libraryEntries.length) {
      throw new BackupError("invalid-metadata", "This backup's file count does not match its contents.");
    }
    if (meta.uncompressedBytes !== declaredBytes) {
      throw new BackupError("invalid-metadata", "This backup's size does not match its contents.");
    }
  }

  const warnings: string[] = [];
  if (meta.schema === 1) {
    warnings.push("This is an older backup format; it will be upgraded after restore.");
  }
  if (!meta.manifestSha256) {
    warnings.push("This backup has no checksum; its contents could not be verified.");
  }

  return {
    entries,
    meta,
    manifest,
    summary: {
      schema: meta.schema,
      createdAt: meta.createdAt,
      appVersion: meta.schema === 2 ? meta.appVersion : "",
      docCount: manifest.docs.length,
      fileCount: libraryEntries.length,
      uncompressedBytes: declaredBytes,
      legacy: meta.schema === 1,
      warnings,
    },
  };
}

/** Validate an archive without touching the live library. */
export async function inspectBackup(
  bytes: Uint8Array,
  limits: ArchiveLimits = BACKUP_LIMITS
): Promise<BackupSummary> {
  const archive = await readArchive(bytes, limits);
  return archive.summary;
}

// ---------------------------------------------------------------------------
// Staging + validation
// ---------------------------------------------------------------------------

async function extractToStaging(
  fs: FileStore,
  bytes: Uint8Array,
  staging: string,
  archive: ParsedArchive,
  limits: ArchiveLimits
): Promise<void> {
  for (const e of archive.entries) {
    if (e.kind !== "library") continue;
    const data = readEntryData(bytes, e.entry, limits);
    await fs.writeBytesAtomic(`${staging}/${e.path}`, data);
  }
}

async function validateStaging(
  fs: FileStore,
  root: string
): Promise<string[]> {
  const warnings: string[] = [];
  const manifest = await readJsonAsync<Manifest>(fs, L.manifest(root));
  if (!manifest) {
    throw new BackupError("missing-manifest", "The backup's manifest could not be read.");
  }
  validateManifestShape(manifest);

  for (const doc of manifest.docs) {
    const meta = await readJsonAsync<DocMeta>(fs, L.docMeta(root, doc.slug));
    if (!meta) {
      throw new BackupError(
        "invalid-library",
        `The backup is missing metadata for “${doc.title}”.`
      );
    }
    if (meta.schema !== 1 || meta.id !== doc.id) {
      throw new BackupError(
        "invalid-library",
        `The backup's metadata for “${doc.title}” does not match its manifest.`
      );
    }
    if (meta.slug !== doc.slug) {
      warnings.push(`“${doc.title}” uses a different folder name in the backup.`);
    }
    if (!Array.isArray(meta.chapters)) {
      throw new BackupError("invalid-library", `“${doc.title}” has no chapter list.`);
    }
    if (!meta.files || typeof meta.files !== "object") {
      throw new BackupError("invalid-library", `“${doc.title}” has no file list.`);
    }
    const reading = meta.files.reading;
    if (!reading) {
      throw new BackupError("invalid-library", `“${doc.title}” has no reading edition.`);
    }

    for (const file of doc.files) {
      const abs = `${root}/${file.path}`;
      const stat = await fs.stat(abs);
      if (!stat || stat.isDir) {
        throw new BackupError(
          "missing-file",
          `The backup is missing a file for “${doc.title}”: ${file.path}`
        );
      }
      if (typeof file.size === "number" && stat.size !== file.size) {
        throw new BackupError(
          "invalid-library",
          `A file for “${doc.title}” has the wrong size.`
        );
      }
      if (file.sha256) {
        const actual = await sha256Hex(await fs.readBytes(abs));
        if (actual !== file.sha256) {
          throw new BackupError(
            "hash-mismatch",
            `A file for “${doc.title}” failed its checksum.`
          );
        }
      }
    }
    if (!(await fs.exists(`${root}/docs/${doc.slug}/${reading.replace(/^\/+/, "")}`))) {
      throw new BackupError("missing-file", `The reading edition for “${doc.title}” is missing.`);
    }
  }

  await validateUserFiles(fs, root);
  return warnings;
}

async function validateUserFiles(fs: FileStore, root: string): Promise<void> {
  const annotations = asArray(
    await readOptionalJson(fs, L.annotations(root)),
    "annotations.json"
  );
  for (const a of annotations) {
    const rec = requireRecord(a, "annotation");
    requireString(rec.id, "an annotation id");
    requireString(rec.docId, "an annotation document id");
  }

  const progress = asRecordMap(
    await readOptionalJson(fs, L.progress(root)),
    "progress.json"
  );
  for (const [id, p] of Object.entries(progress)) {
    const rec = requireRecord(p, "progress entry");
    requireString(rec.docId ?? id, "a progress document id");
    if (typeof rec.percent !== "number") {
      throw new BackupError("invalid-library", "A progress entry has no percentage.");
    }
  }

  const collections = asArray(
    await readOptionalJson(fs, L.collections(root)),
    "collections.json"
  );
  for (const c of collections) {
    const rec = requireRecord(c, "collection");
    requireString(rec.id, "a collection id");
    requireString(rec.name, "a collection name");
    if (!Array.isArray(rec.docIds)) {
      throw new BackupError("invalid-library", "A collection has no document list.");
    }
  }

  const settings = await readOptionalJson(fs, L.settings(root));
  if (settings !== undefined && !isRecord(settings)) {
    throw new BackupError("invalid-library", "The backup's settings.json is malformed.");
  }
  const docSettings = await readOptionalJson(fs, L.docSettings(root));
  if (docSettings !== undefined && !isRecord(docSettings)) {
    throw new BackupError("invalid-library", "The backup's doc-settings.json is malformed.");
  }
}

// ---------------------------------------------------------------------------
// Replace
// ---------------------------------------------------------------------------

async function replaceLibrary(
  fs: FileStore,
  root: string,
  staging: string,
  warnings: string[]
): Promise<string[]> {
  const rollback = `${root}.rollback-${Date.now()}`;
  const hadRoot = await treeExists(fs, root);
  if (hadRoot) await fs.move(root, rollback);

  try {
    await fs.move(staging, root);
  } catch (e) {
    if (hadRoot) {
      await fs.move(rollback, root).catch(() => {});
    }
    throw new BackupError(
      "staging",
      `The restored library could not be moved into place. ${readable(e)}`,
      rollback
    );
  }

  let docIds: string[];
  try {
    const manifest = await readJsonAsync<Manifest>(fs, L.manifest(root));
    if (!manifest) throw new Error("manifest is missing after the swap");
    docIds = validateManifestShape(manifest).docs.map((d) => d.id);
  } catch (e) {
    await fs.delete(root).catch(() => {});
    if (hadRoot) {
      await fs.move(rollback, root).catch(() => {});
    }
    throw new BackupError(
      "rollback",
      `The restored library failed verification and the previous library was restored. ${readable(e)}`,
      rollback
    );
  }

  if (hadRoot) {
    try {
      await fs.delete(rollback);
    } catch (e) {
      warnings.push(
        `The previous library copy could not be removed; it remains at ${rollback} (${readable(e)}).`
      );
    }
  }
  return docIds;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

async function readDocFolder(
  fs: FileStore,
  dir: string,
  rel = ""
): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const e of await fs.list(dir)) {
    const name = basename(e.path);
    if (!name) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    if (e.isDir) {
      const nested = await readDocFolder(fs, e.path, childRel);
      Object.assign(out, nested);
    } else if (childRel !== "meta.json") {
      out[childRel] = await fs.readBytes(e.path);
    }
  }
  return out;
}

interface UserDataSnapshot {
  annotations: Annotation[] | undefined;
  progress: Record<string, unknown> | undefined;
  collections: Collection[] | undefined;
  docSettings: Record<string, unknown> | undefined;
  settings: unknown;
}

async function readUserData(fs: FileStore, root: string): Promise<UserDataSnapshot> {
  return {
    annotations: asArray(await readOptionalJson(fs, L.annotations(root)), "annotations.json") as Annotation[],
    progress: asRecordMap(await readOptionalJson(fs, L.progress(root)), "progress.json"),
    collections: asArray(
      await readOptionalJson(fs, L.collections(root)),
      "collections.json"
    ) as Collection[],
    docSettings: asRecordMap(
      await readOptionalJson(fs, L.docSettings(root)),
      "doc-settings.json"
    ),
    settings: await readOptionalJson(fs, L.settings(root)),
  };
}

async function mergeLibrary(
  fs: FileStore,
  root: string,
  staging: string,
  archive: ParsedArchive,
  warnings: string[]
): Promise<Omit<RestoreResult, "mode" | "reindexed" | "reindexFailures"> & { addedIds: string[] }> {
  const lm = new LibraryManager(fs, root);
  const live = await readJsonAsync<Manifest>(fs, L.manifest(root));
  if (live) validateManifestShape(live);
  const liveDocs = live?.docs ?? [];

  // Read user data before mutating anything so a corrupt local file aborts
  // the merge instead of leaving a half-applied restore.
  const liveUser = await readUserData(fs, root);
  const stagedUser = await readUserData(fs, staging);

  const liveById = new Map(liveDocs.map((d) => [d.id, d]));
  const liveByHash = new Map(liveDocs.map((d) => [d.contentHash, d]));
  const knownDocIds = new Set(liveDocs.map((d) => d.id));
  const idMap = new Map<string, string>();
  const addedIds: string[] = [];
  const skippedDocs: SkippedDoc[] = [];
  let conflicts = 0;

  for (const stagedDoc of archive.manifest.docs) {
    const meta = await readJsonAsync<DocMeta>(
      fs,
      L.docMeta(staging, stagedDoc.slug)
    );
    if (!meta) {
      skippedDocs.push({ title: stagedDoc.title, reason: "metadata is missing" });
      continue;
    }
    const match = liveById.get(stagedDoc.id) ?? liveByHash.get(stagedDoc.contentHash);
    if (match) {
      idMap.set(stagedDoc.id, match.id);
      if (match.contentHash !== stagedDoc.contentHash) {
        conflicts++;
        skippedDocs.push({
          title: stagedDoc.title,
          reason: "a different version is already in your library",
        });
      }
      continue;
    }

    const importMeta: DocMeta = { ...meta, id: stagedDoc.id, slug: stagedDoc.slug };
    // addDoc only resolves collisions when the slug is empty.
    const usedSlugs = new Set(await lm.meta.listSlugs());
    if (usedSlugs.has(importMeta.slug)) importMeta.slug = "";
    try {
      const files = await readDocFolder(fs, L.docDir(staging, stagedDoc.slug));
      if (!Object.keys(files).some((p) => p.startsWith("reading/"))) {
        throw new Error("the reading edition is missing");
      }
      await lm.addDoc({ meta: importMeta, files });
      addedIds.push(importMeta.id);
      knownDocIds.add(importMeta.id);
      idMap.set(stagedDoc.id, importMeta.id);
    } catch (e) {
      skippedDocs.push({ title: stagedDoc.title, reason: readable(e) });
    }
  }

  const counts = await mergeUserData(
    fs,
    lm,
    root,
    liveUser,
    stagedUser,
    idMap,
    knownDocIds
  );

  if (liveUser.settings === undefined && stagedUser.settings !== undefined) {
    await writeJsonAtomic(fs, L.settings(root), stagedUser.settings);
  }

  await reconcileCollectionMembership(fs, lm, counts.collections, warnings);

  return {
    addedDocs: addedIds.length,
    skippedDocs,
    conflicts,
    annotationsMerged: counts.annotations,
    progressMerged: counts.progress,
    collectionsMerged: counts.collections.length,
    warnings,
    addedIds,
  };
}

interface MergeCounts {
  annotations: number;
  progress: number;
  collections: Collection[];
}

async function mergeUserData(
  fs: FileStore,
  lm: LibraryManager,
  root: string,
  live: UserDataSnapshot,
  staged: UserDataSnapshot,
  idMap: Map<string, string>,
  knownDocIds: Set<string>
): Promise<MergeCounts> {
  let annotationsChanged = 0;
  const annotations = new Map((live.annotations ?? []).map((a) => [a.id, a]));
  for (const a of staged.annotations ?? []) {
    const docId = idMap.get(a.docId) ?? a.docId;
    if (!knownDocIds.has(docId)) continue;
    const next = { ...a, docId };
    const current = annotations.get(a.id);
    if (!current) {
      annotations.set(a.id, next);
      annotationsChanged++;
    } else if (newest(next, current)) {
      annotations.set(a.id, next);
      annotationsChanged++;
    }
  }
  if (annotationsChanged > 0) {
    await lm.annotations.writeAll([...annotations.values()]);
  }

  let progressChanged = 0;
  const progress: Record<string, Progress> = { ...(live.progress as Record<string, Progress>) };
  for (const [key, raw] of Object.entries(staged.progress ?? {})) {
    const value = raw as Progress;
    const docId = idMap.get(key) ?? (typeof value.docId === "string" ? value.docId : key);
    if (!knownDocIds.has(docId)) continue;
    const next = { ...value, docId };
    const current = progress[docId];
    if (!current || newest(next, current)) {
      progress[docId] = next;
      progressChanged++;
    }
  }
  if (progressChanged > 0) {
    await writeJsonAtomic(fs, L.progress(root), progress);
  }

  let collectionsChanged = 0;
  const collections = new Map(
    (live.collections ?? []).map((c) => [c.id, { ...c, docIds: [...c.docIds] }])
  );
  for (const c of staged.collections ?? []) {
    const docIds = [
      ...new Set(
        c.docIds.map((id) => idMap.get(id) ?? id).filter((id) => knownDocIds.has(id))
      ),
    ];
    const current = collections.get(c.id);
    if (!current) {
      collections.set(c.id, { ...c, docIds });
      collectionsChanged++;
    } else {
      const union = [...new Set([...current.docIds, ...docIds])];
      if (union.length !== current.docIds.length) {
        current.docIds = union;
        collectionsChanged++;
      }
    }
  }
  if (collectionsChanged > 0) {
    await lm.collections.save([...collections.values()]);
  }

  const docSettings: Record<string, unknown> = { ...(live.docSettings ?? {}) };
  let settingsChanged = 0;
  for (const [id, prefs] of Object.entries(staged.docSettings ?? {})) {
    const docId = idMap.get(id) ?? id;
    if (!knownDocIds.has(docId) || docId in docSettings) continue;
    docSettings[docId] = prefs;
    settingsChanged++;
  }
  if (settingsChanged > 0) {
    await writeJsonAtomic(fs, L.docSettings(root), docSettings);
  }

  return {
    annotations: annotationsChanged,
    progress: progressChanged,
    collections: [...collections.values()],
  };
}

/**
 * Union collection membership onto each doc's meta.json (dual-write), then
 * rewrite the manifest last with refreshed meta hashes.
 */
async function reconcileCollectionMembership(
  fs: FileStore,
  lm: LibraryManager,
  collections: Collection[],
  warnings: string[]
): Promise<void> {
  const desired = new Map<string, Set<string>>();
  for (const c of collections) {
    for (const docId of c.docIds) {
      const set = desired.get(docId) ?? new Set<string>();
      set.add(c.id);
      desired.set(docId, set);
    }
  }
  if (desired.size === 0) return;

  const manifest = await lm.load();
  if (!manifest) return;
  let manifestChanged = false;
  for (const doc of manifest.docs) {
    const want = desired.get(doc.id);
    if (!want) continue;
    const meta = await lm.meta.read(doc.slug);
    if (!meta) continue;
    const current = meta.collectionIds ?? [];
    const union = [...new Set([...current, ...want])];
    if (union.length === current.length) continue;
    meta.collectionIds = union;
    await lm.meta.write(doc.slug, meta);
    try {
      const bytes = await fs.readBytes(L.docMeta(lm.root, doc.slug));
      const entry = {
        path: `docs/${doc.slug}/meta.json`,
        size: bytes.length,
        sha256: await sha256Hex(bytes),
      };
      doc.files = doc.files.filter((f) => f.path !== entry.path);
      doc.files.push(entry);
      doc.updatedAt = nowIso();
      manifestChanged = true;
    } catch (e) {
      warnings.push(`A collection update could not be recorded for “${doc.title}”: ${readable(e)}`);
    }
  }
  if (manifestChanged) await lm.manifest.write(manifest);
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export interface RestoreOptions {
  fs: FileStore;
  root: string;
  bytes: Uint8Array;
  mode: "merge" | "replace";
  limits?: ArchiveLimits;
  onPhase?: (phase: RestorePhase) => void;
}

export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const { fs, root, bytes, mode } = options;
  const limits = options.limits ?? BACKUP_LIMITS;
  const phase = options.onPhase ?? (() => {});

  phase("reading");
  const archive = await readArchive(bytes, limits);

  if (mode === "replace") {
    const free = await fs.freeSpace();
    if (free > 0 && free < archive.summary.uncompressedBytes) {
      throw new BackupError(
        "too-large",
        "There is not enough free space to stage this backup. Free some space and try again."
      );
    }
  }

  const staging = `${workspaceOf(root)}/restore-${newUuid()}`;
  await fs.delete(staging);
  const warnings = [...archive.summary.warnings];

  try {
    phase("extracting");
    await extractToStaging(fs, bytes, staging, archive, limits);

    phase("validating");
    warnings.push(...(await validateStaging(fs, staging)));

    phase("applying");
    let docIds: string[];
    let result: Omit<RestoreResult, "reindexed" | "reindexFailures" | "warnings">;

    if (mode === "replace") {
      docIds = await replaceLibrary(fs, root, staging, warnings);
      result = {
        mode,
        addedDocs: docIds.length,
        skippedDocs: [],
        conflicts: 0,
        annotationsMerged: 0,
        progressMerged: 0,
        collectionsMerged: 0,
      };
    } else {
      const merged = await mergeLibrary(fs, root, staging, archive, warnings);
      docIds = [...merged.addedIds];
      result = {
        mode,
        addedDocs: merged.addedDocs,
        skippedDocs: merged.skippedDocs,
        conflicts: merged.conflicts,
        annotationsMerged: merged.annotationsMerged,
        progressMerged: merged.progressMerged,
        collectionsMerged: merged.collectionsMerged,
      };
      // Rebuild missing/derived indexes for existing docs too.
      const manifest = await readJsonAsync<Manifest>(fs, L.manifest(root));
      for (const doc of manifest?.docs ?? []) {
        if (!docIds.includes(doc.id) && !(await fs.exists(L.indexText(root, doc.id)))) {
          docIds.push(doc.id);
        }
      }
    }

    phase("indexing");
    const reindex = await reindexDocs(fs, root, docIds);
    if (reindex.failed.length > 0) {
      warnings.push(
        `${reindex.failed.length} document${reindex.failed.length === 1 ? "" : "s"} could not be indexed for search.`
      );
    }
    phase("done");

    return {
      ...result,
      reindexed: reindex.indexed,
      reindexFailures: reindex.failed,
      warnings,
    };
  } finally {
    // No-op after a successful replace (staging was moved) and after a
    // rollback; removes an abandoned staging tree on validation failure.
    await fs.delete(staging).catch(() => {});
  }
}

/**
 * Startup repair for the two-rename replace transaction.
 *
 * The dangerous window is between `root → rollback` and `staging → root`.
 * If the app died there the live root is gone and the newest rollback tree is
 * the real library, so it is put back. If the root does exist, it is only
 * trusted when its manifest parses; otherwise it is moved aside (never deleted)
 * and the rollback is restored. Abandoned staging trees are always dropped.
 */
export async function recoverInterruptedRestore(
  fs: FileStore,
  root: string
): Promise<boolean> {
  const workspace = workspaceOf(root);
  const base = basename(root);
  let entries;
  try {
    entries = await fs.list(workspace);
  } catch {
    return false;
  }
  const staging = entries
    .filter((e) => e.isDir && basename(e.path).startsWith("restore-"))
    .map((e) => e.path);
  const rollbacks = entries
    .filter((e) => e.isDir && basename(e.path).startsWith(`${base}.rollback-`))
    .map((e) => e.path)
    .sort()
    .reverse();

  const rootPresent = await treeExists(fs, root);
  const needsRollback =
    rollbacks.length > 0 && (!rootPresent || !(await rootHasValidManifest(fs, root)));

  if (needsRollback) {
    if (rootPresent) {
      // Preserve the unusable tree instead of deleting it; a human can still
      // salvage files from `library.corrupt-<ts>`.
      await fs
        .move(root, `${root}.corrupt-${Date.now()}`)
        .catch(() => fs.delete(root));
    }
    await fs.move(rollbacks[0], root);
    for (const extra of rollbacks.slice(1)) await fs.delete(extra).catch(() => {});
    for (const s of staging) await fs.delete(s).catch(() => {});
    return true;
  }

  for (const s of staging) await fs.delete(s).catch(() => {});
  // The live root is healthy, so the replace committed; stale copies can go.
  for (const r of rollbacks) await fs.delete(r).catch(() => {});
  return false;
}

async function rootHasValidManifest(fs: FileStore, root: string): Promise<boolean> {
  try {
    if (!(await fs.exists(L.manifest(root)))) return false;
    validateManifestShape(await readJsonAsync<Manifest>(fs, L.manifest(root)));
    return true;
  } catch {
    return false;
  }
}
