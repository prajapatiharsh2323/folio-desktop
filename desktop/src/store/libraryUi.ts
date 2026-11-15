// Library UI state: rows (manifest + progress), import with duplicate gate,
// recovery banners (06 §1). Persists through the Tauri FileStore when available,
// Memory store in browser dev.
import { create } from "zustand";
import { MemoryFileStore, TauriFileStore, type FileStore } from "../lib/fileStore";
import { LibraryManager } from "./libraryManager";
import { importFile, type DuplicateResolution, type ImportResult } from "../import/importService";
import { tintIndexFromHash } from "../import/cover";
import { getBookCoverPreset } from "../lib/coverPresets";
import { pushToast } from "../shell/toasts";
import { handleError } from "../lib/errorLog";
import { COPY, MAX_IMPORT_BYTES } from "../import/fileDetector";
import type { PickedFile } from "../lib/fileSource";
import type { DocMeta, ManifestDoc, Progress } from "../model/types";

export interface LibraryRow {
  id: string;
  slug: string;
  title: string;
  author?: string | null;
  kind: "book" | "article";
  percent: number | null; // null → "New"
  tint: number;
  coverUrl?: string | null;
  /** Manifest import time (row creation), for the Date-added sort. */
  importedAt: string;
  /** Later of last-read and imported-at — the "Recent activity" sort key. */
  activityAt: string;
  /** L4/L5: tags from meta.json, for the tag filter chips. */
  tags: string[];
  /** L5: when the book was last read (progress touch), null for New. */
  lastReadAt: string | null;
  /**
   * L5: estimated minutes of reading left, from the recorded reading pace
   * (percent per session-millisecond over the book's remaining percent).
   * null when no pace was recorded or the book is finished.
   */
  minutesLeft: number | null;
}

export interface RecoveryInfo {
  damaged: { id: string; slug: string; title: string }[];
  interrupted: { slug: string; hasFiles: boolean }[];
}

export interface ImportOutcome {
  /** Documents added or replaced. */
  added: number;
  skipped: number;
  failures: string[];
  /** Title of the last added/replaced/skipped document, when known. */
  title: string | null;
  /** Doc ids added or replaced by this batch (L3: highlight + scroll). */
  docIds: string[];
}

interface LibraryUiState {
  rows: LibraryRow[];
  loading: boolean;
  /** L1: a refresh over a non-empty shelf shows a subtle bar, not a blank. */
  refreshing: boolean;
  error: string | null;
  recovery: RecoveryInfo | null;
  recoveryDialogOpen: boolean;
  duplicate: { title: string; resolve: (r: DuplicateResolution) => void } | null;
  /**
   * Step 3.2: live per-file import progress; non-null while a batch runs.
   * The dialog offers Cancel, which stops the batch after the current file.
   */
  importProgress: { index: number; total: number; name: string } | null;
  /** L3: doc ids from the most recent import, for highlight + scroll. */
  lastImportedIds: string[];
  refresh: () => Promise<void>;
  /** L2: patch only the rows for these doc ids (post-import). */
  refreshDocs: (docIds: string[]) => Promise<void>;
  importPicked: (files: PickedFile[]) => Promise<ImportOutcome>;
  /** Stop the running import batch after the file in flight completes. */
  cancelImport: () => void;
  resolveDuplicate: (r: DuplicateResolution, applyAll?: boolean) => void;
  /** Resolve a pending duplicate prompt as "skip" when its screen unmounts. */
  cancelDuplicate: () => void;
  removeDamaged: (id: string, slug: string) => Promise<void>;
  removeInterrupted: (slug: string) => Promise<void>;
  setRecoveryDialogOpen: (open: boolean) => void;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let fs: FileStore | null = null;
export function getLibraryFs(): FileStore {
  if (!fs) fs = isTauri() ? new TauriFileStore() : new MemoryFileStore();
  return fs;
}

/** Custom covers are object URLs; every refresh must release the old batch. */
let coverUrls: string[] = [];

/**
 * Per-document cover cache. Re-reading and re-decoding every cover on each
 * refresh is the expensive part of the shelf; the stat key (size + mtime)
 * makes a replaced cover file invalidate only its own entry.
 */
const coverCache = new Map<string, { key: string; url: string }>();

/**
 * L1: per-document meta cache keyed by the manifest's per-doc `updatedAt`
 * (bumped whenever meta.json is rewritten), so an unchanged shelf costs zero
 * meta reads. Entries are evicted when their doc leaves the manifest.
 */
const metaCache = new Map<string, { key: string; meta: DocMeta | null }>();

function revokeCoverUrl(url: string): void {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

export const LIBRARY_ROOT = "/folio-library/library";

export function getLibraryManager(): LibraryManager {
  return new LibraryManager(getLibraryFs(), LIBRARY_ROOT);
}

function libraryManager(): LibraryManager {
  return getLibraryManager();
}

function coverPathFor(slug: string, cover: string): string {
  return `${LIBRARY_ROOT}/docs/${slug}/${cover.replace(/^\/+/, "")}`;
}

/** Import-time thumbnail (L3): an additive cache file, when one was written. */
function thumbPathFor(slug: string): string {
  return `${LIBRARY_ROOT}/docs/${slug}/cache/cover-thumb.jpg`;
}

function coverMime(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

/** L1: bounded parallelism for per-doc work (meta reads, cover stats). */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** Cached meta read; a damaged meta.json yields null without failing the shelf. */
async function metaCached(doc: ManifestDoc): Promise<DocMeta | null> {
  const cached = metaCache.get(doc.slug);
  if (cached && cached.key === doc.updatedAt) return cached.meta;
  let meta: DocMeta | null = null;
  try {
    meta = await libraryManager().meta.read(doc.slug);
  } catch (e) {
    handleError(e, { context: "library.meta.read" });
  }
  metaCache.set(doc.slug, { key: doc.updatedAt, meta });
  return meta;
}

/**
 * Resolve cover object URLs for a set of docs (L1): one stat per cover under
 * bounded parallelism; stat-key cache hits are free, and all misses are read
 * in a single batched `readMany` (prefer the import-time thumbnail, fall
 * back to the full cover). Returns slug → url (null when none resolvable).
 */
async function resolveCovers(
  fs: FileStore,
  wanted: { slug: string; cover: string }[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (wanted.length === 0) return result;

  // Stat each cover once (concurrency 8) for the cache key.
  await mapWithConcurrency(wanted, 8, async (w) => {
    const target = w as { key?: string };
    try {
      const s = await fs.stat(coverPathFor(w.slug, w.cover));
      target.key = s ? `${s.size}:${s.mtimeMs}` : "missing";
    } catch {
      target.key = "unknown";
    }
  });

  const misses: { slug: string; cover: string; key?: string }[] = [];
  for (const w of wanted) {
    const cached = coverCache.get(w.slug);
    if (cached && cached.key === (w as { key?: string }).key) {
      result.set(w.slug, cached.url);
    } else {
      misses.push(w as { slug: string; cover: string; key?: string });
    }
  }
  if (misses.length === 0) return result;

  // Batched read (L1): thumbnail first, full cover second, per doc.
  const paths = misses.flatMap((w) => [thumbPathFor(w.slug), coverPathFor(w.slug, w.cover)]);
  let bytes: (Uint8Array | null)[];
  try {
    bytes = await fs.readMany(paths);
  } catch {
    bytes = [];
    for (const p of paths) {
      try {
        bytes.push(await fs.readBytes(p));
      } catch {
        bytes.push(null);
      }
    }
  }

  for (let m = 0; m < misses.length; m++) {
    const w = misses[m];
    const key = w.key ?? "missing";
    const thumb = bytes[2 * m] ?? null;
    const full = bytes[2 * m + 1] ?? null;
    const data = thumb ?? full;
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || data === null) {
      result.set(w.slug, null);
      continue;
    }
    const mime = thumb !== null ? "image/jpeg" : coverMime(w.cover);
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
    const cached = coverCache.get(w.slug);
    if (cached) revokeCoverUrl(cached.url);
    coverCache.set(w.slug, { key, url });
    result.set(w.slug, url);
  }
  return result;
}

function rowFrom(
  doc: { id: string; slug: string; title: string; contentHash: string; updatedAt?: string },
  meta:
    | (Pick<DocMeta, "author" | "kind" | "importedAt"> & {
        files?: { cover?: string | null };
      })
    | null,
  progress: Progress | null,
  coverUrl?: string | null,
): LibraryRow {
  // Date-added comes from meta (set at import); the manifest touch time is
  // the fallback. Recent-activity is the later of that and the last read.
  const importedAt = meta?.importedAt || doc.updatedAt || "";
  const lastRead = progress?.updatedAt ?? "";
  const activityAt = importedAt > lastRead ? importedAt : lastRead;
  // L5: a rough "time left in the book" from the recorded pace, only while
  // the book is actually in progress — never for New or finished books.
  let minutesLeft: number | null = null;
  const pace = progress?.pace;
  if (pace && pace.percentRead > 0 && pace.sessionsMs > 0 && progress) {
    const pct = progress.percent ?? 0;
    if (pct > 0 && pct < 100) {
      const msLeft = (100 - pct) / (pace.percentRead / pace.sessionsMs);
      if (Number.isFinite(msLeft)) minutesLeft = Math.max(1, Math.round(msLeft / 60000));
    }
  }
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    author: meta?.author ?? null,
    kind: meta?.kind ?? "book",
    percent: progress ? progress.percent : null,
    tint: tintIndexFromHash(doc.contentHash),
    coverUrl: coverUrl ?? getBookCoverPreset(doc.contentHash || doc.id),
    importedAt,
    activityAt,
    tags: meta?.tags ?? [],
    lastReadAt: progress ? progress.updatedAt : null,
    minutesLeft,
  };
}

export const useLibraryUi = create<LibraryUiState>((set, get) => ({
  rows: [],
  loading: false,
  refreshing: false,
  error: null,
  recovery: null,
  recoveryDialogOpen: false,
  duplicate: null,
  importProgress: null,
  lastImportedIds: [],

  refresh: async () => {
    // L1: a refresh over a non-empty shelf keeps the rows on screen (loading
    // state only for a cold load); the screen shows a subtle bar meanwhile.
    const hasRows = get().rows.length > 0;
    set(hasRows ? { refreshing: true, error: null } : { loading: true, error: null });
    const nextCoverUrls: string[] = [];
    const usedCoverSlugs = new Set<string>();
    try {
      const fs = getLibraryFs();
      const lm = libraryManager();
      const manifest = await lm.load();
      const progress = await lm.progress.all();
      const docs = manifest?.docs ?? [];

      // Evict meta-cache entries for docs that left the manifest.
      const live = new Set(docs.map((d) => d.slug));
      for (const slug of [...metaCache.keys()]) {
        if (!live.has(slug)) metaCache.delete(slug);
      }

      // Meta reads: cache hits are free; misses run under bounded parallelism.
      const metas = await mapWithConcurrency(docs, 8, (doc) => metaCached(doc));

      // Covers: cache-hit stats + one batched read for the misses.
      const wanted = docs
        .map((doc, i) => ({ slug: doc.slug, cover: metas[i]?.files?.cover ?? null }))
        .filter((w): w is { slug: string; cover: string } => w.cover !== null);
      const coverUrlsBySlug = await resolveCovers(fs, wanted);

      const rows: LibraryRow[] = docs.map((doc, i) => {
        const meta = metas[i];
        const slug = doc.slug;
        if (meta?.files?.cover) {
          usedCoverSlugs.add(slug);
          const url = coverUrlsBySlug.get(slug);
          if (url) nextCoverUrls.push(url);
        }
        return rowFrom(
          doc,
          meta,
          progress[doc.id] ?? null,
          meta?.files?.cover ? (coverUrlsBySlug.get(slug) ?? null) : null,
        );
      });

      const recovery = await lm.detectRecovery();
      // Swap rows first, then release covers that are no longer referenced.
      const stale = [...coverCache.entries()].filter(([slug]) => !usedCoverSlugs.has(slug));
      coverUrls = nextCoverUrls;
      set({
        rows,
        loading: false,
        refreshing: false,
        error: null,
        recovery: recovery.damaged.length > 0 || recovery.interrupted.length > 0 ? recovery : null,
      });
      for (const [slug, entry] of stale) {
        coverCache.delete(slug);
        // Let React commit the new rows before releasing the previous cover.
        // A macrotask runs after React's microtask flush; releasing inside a
        // microtask could blank an image that is still on screen.
        setTimeout(() => revokeCoverUrl(entry.url), 0);
      }
    } catch (e) {
      // A failed refresh never owns the URLs it created: keep the previous
      // batch alive and release only the fresh ones.
      handleError(e, { context: "library.refresh" });
      for (const url of nextCoverUrls) {
        if (coverUrls.includes(url)) continue;
        revokeCoverUrl(url);
        for (const [slug, entry] of coverCache) {
          if (entry.url === url) coverCache.delete(slug);
        }
      }
      const message = e instanceof Error ? e.message : "Library load failed";
      set({ loading: false, refreshing: false, error: message });
      pushToast({ tone: "error", text: message });
    }
  },

  /**
   * L2: patch only the rows for the given doc ids (post-import). The rest of
   * the shelf is left untouched — no full re-stat, no cover churn.
   */
  refreshDocs: async (docIds: string[]) => {
    if (docIds.length === 0) return;
    try {
      const fs = getLibraryFs();
      const lm = libraryManager();
      const manifest = await lm.load();
      const progress = await lm.progress.all();
      const docs = (manifest?.docs ?? []).filter((d) => docIds.includes(d.id));
      if (docs.length === 0) {
        await get().refresh();
        return;
      }
      const metas = await mapWithConcurrency(docs, 8, (doc) => metaCached(doc));
      const wanted = docs
        .map((doc, i) => ({ slug: doc.slug, cover: metas[i]?.files?.cover ?? null }))
        .filter((w): w is { slug: string; cover: string } => w.cover !== null);
      const coverUrlsBySlug = await resolveCovers(fs, wanted);

      const patch = new Map<string, LibraryRow>();
      docs.forEach((doc, i) => {
        const meta = metas[i];
        const url = meta?.files?.cover ? (coverUrlsBySlug.get(doc.slug) ?? null) : null;
        if (meta?.files?.cover && url) {
          coverUrls = [...coverUrls, url];
        }
        patch.set(doc.id, rowFrom(doc, meta, progress[doc.id] ?? null, url));
      });

      const current = get().rows;
      const rows = current.map((r) => patch.get(r.id) ?? r);
      // Docs not on the shelf yet (first import) are appended.
      for (const doc of docs) {
        if (!rows.some((r) => r.id === doc.id)) {
          const row = patch.get(doc.id);
          if (row) rows.push(row);
        }
      }
      set({ rows, loading: false, refreshing: false, error: null });
    } catch (e) {
      // The incremental patch is an optimization: fall back to a full refresh.
      handleError(e, { context: "library.refreshDocs" });
      await get().refresh();
    }
  },

  importPicked: (files) => enqueueImport(files),

  cancelImport: () => {
    importCancelled = true;
  },

  resolveDuplicate: (r, applyAll = false) => {
    if (applyAll) duplicateApplyAll = r;
    const dup = get().duplicate;
    set({ duplicate: null });
    dup?.resolve(r);
  },

  cancelDuplicate: () => {
    const dup = get().duplicate;
    if (!dup) return;
    set({ duplicate: null });
    dup.resolve("skip");
  },

  removeDamaged: async (id, slug) => {
    const lm = libraryManager();
    await lm.removeDamagedFromManifest(id);
    await lm.removeDamagedFolder(slug);
    await get().refresh();
  },

  removeInterrupted: async (slug) => {
    const lm = libraryManager();
    await lm.removeDamagedFolder(slug);
    await get().refresh();
  },

  setRecoveryDialogOpen: (open) => set({ recoveryDialogOpen: open }),
}));

// Imports are serialised process-wide: open-with, Ctrl+I, a drop and the empty
// state button can all fire before the previous batch finishes. A single chain
// keeps duplicate prompts and manifest writes from interleaving.
let importQueue: Promise<void> = Promise.resolve();

/** Step 3.2: cancel flag for the batch in flight (checked between files). */
let importCancelled = false;

/**
 * L10: "Apply to all remaining" — when the duplicate dialog resolves with the
 * apply-all flag set, later duplicates in the same batch resolve silently
 * with this choice instead of prompting again. Reset at each batch start.
 */
let duplicateApplyAll: DuplicateResolution | null = null;

function enqueueImport(files: PickedFile[]): Promise<ImportOutcome> {
  if (files.length === 0) {
    return Promise.resolve({ added: 0, skipped: 0, failures: [], title: null, docIds: [] });
  }
  const run = importQueue.then(
    () => runImportBatch(files),
    () => runImportBatch(files),
  );
  importQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function runImportBatch(files: PickedFile[]): Promise<ImportOutcome> {
  const lm = libraryManager();
  const multi = files.length > 1;
  let imported = 0;
  let replaced = 0;
  let skipped = 0;
  let lastTitle: string | null = null;
  const failures: string[] = [];
  const importedIds: string[] = [];
  importCancelled = false;
  duplicateApplyAll = null;

  try {
    for (const [index, file] of files.entries()) {
      // Cancel lands between files: the one in flight always finishes so the
      // manifest and folders stay consistent.
      if (importCancelled) break;
      useLibraryUi.setState({
        importProgress: { index: index + 1, total: files.length, name: file.name },
      });
      try {
        // Read lazily, one file at a time (Step 3.2): a multi-file pick never
        // holds every book's bytes at once. Oversized picks are refused before
        // the read when the size is known up front.
        if (file.size !== null && file.size > MAX_IMPORT_BYTES) {
          failures.push(`${file.name}: ${COPY.tooLarge}`);
          continue;
        }
        const bytes = await file.read();
        const result: ImportResult = await importFile(
          lm,
          file.name,
          bytes,
          (title) => {
            // L10: an earlier "Apply to all remaining" answers this prompt.
            if (duplicateApplyAll) return Promise.resolve(duplicateApplyAll);
            return new Promise<DuplicateResolution>((resolve) => {
              useLibraryUi.setState({ duplicate: { title, resolve } });
            });
          },
        );
        if (result.status === "imported") {
          imported += 1;
          lastTitle = result.title ?? file.name;
          if (result.docId) importedIds.push(result.docId);
        } else if (result.status === "replaced") {
          replaced += 1;
          lastTitle = result.title ?? file.name;
          if (result.docId) importedIds.push(result.docId);
        } else if (result.status === "skipped") {
          skipped += 1;
          lastTitle = result.title ?? file.name;
        } else {
          failures.push(`${file.name}: ${result.error ?? "Import failed"}`);
        }
      } catch (e) {
        handleError(e, { context: "library.import" });
        failures.push(`${file.name}: ${e instanceof Error ? e.message : "Import failed"}`);
      } finally {
        useLibraryUi.setState({ importProgress: null });
      }
    }
  } finally {
    useLibraryUi.setState({ importProgress: null });
    // L2: when something was added/replaced, patch just those rows; a full
    // refresh still reconciles the shelf when every file failed or was
    // skipped (recovery banners, error state).
    if (importedIds.length > 0) {
      await useLibraryUi.getState().refreshDocs(importedIds);
      useLibraryUi.setState({ lastImportedIds: [...importedIds] });
    } else {
      await useLibraryUi.getState().refresh();
    }
  }

  const refreshError = useLibraryUi.getState().error;
  const details = refreshError ? [...failures, `Library refresh: ${refreshError}`] : failures;
  const added = imported + replaced;
  const cancelled = importCancelled;
  importCancelled = false;
  const outcome: ImportOutcome = {
    added,
    skipped,
    failures,
    title: lastTitle,
    docIds: importedIds,
  };

  if (!multi) {
    if (failures.length > 0) {
      pushToast({ tone: "error", text: "Import failed", details });
      return outcome;
    }
    if (skipped === 1 && added === 0) {
      pushToast({ tone: "success", text: "Already in your library — skipped" });
      return outcome;
    }
    if (added > 0) {
      const verb = replaced > 0 ? "Replaced" : "Imported";
      pushToast({
        tone: refreshError ? "error" : "success",
        text: refreshError
          ? `${verb} “${lastTitle ?? "book"}” — library refresh failed`
          : `${verb} “${lastTitle ?? "book"}”`,
        details: refreshError ? details : undefined,
      });
      return outcome;
    }
    if (refreshError) pushToast({ tone: "error", text: "Library refresh failed", details });
    return outcome;
  }

  if (added === 0 && skipped === 0 && failures.length === 0) {
    if (refreshError) pushToast({ tone: "error", text: "Library refresh failed", details });
    return outcome;
  }

  const parts: string[] = [];
  if (added > 0) parts.push(`Imported ${added}`);
  if (skipped > 0) parts.push(`skipped ${skipped}`);
  if (failures.length > 0) parts.push(`${failures.length} failed`);
  if (cancelled) parts.push("cancelled");
  if (refreshError) parts.push("refresh failed");

  pushToast({
    tone: failures.length > 0 || refreshError ? "error" : "success",
    text: parts.join(", "),
    details: details.length > 0 ? details : undefined,
  });
  return outcome;
}
