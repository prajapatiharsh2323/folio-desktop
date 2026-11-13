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
import type { Progress } from "../model/types";

export interface LibraryRow {
  id: string;
  slug: string;
  title: string;
  author?: string | null;
  kind: "book" | "article";
  percent: number | null; // null → "New"
  tint: number;
  coverUrl?: string | null;
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
}

interface LibraryUiState {
  rows: LibraryRow[];
  loading: boolean;
  error: string | null;
  recovery: RecoveryInfo | null;
  recoveryDialogOpen: boolean;
  duplicate: { title: string; resolve: (r: DuplicateResolution) => void } | null;
  refresh: () => Promise<void>;
  importPicked: (files: { name: string; bytes: Uint8Array }[]) => Promise<ImportOutcome>;
  resolveDuplicate: (r: DuplicateResolution) => void;
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

function revokeCoverUrl(url: string): void {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

async function loadCoverUrl(slug: string, coverPath: string): Promise<string | null> {
  const path = `${LIBRARY_ROOT}/docs/${slug}/${coverPath.replace(/^\/+/, "")}`;
  const cached = coverCache.get(slug);
  let key: string;
  try {
    const stat = await getLibraryFs().stat(path);
    key = stat ? `${stat.size}:${stat.mtimeMs}` : "missing";
  } catch {
    key = "unknown";
  }
  if (cached && cached.key === key) return cached.url;

  try {
    const bytes = await getLibraryFs().readBytes(path);
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return null;
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: coverMime(coverPath) }));
    if (cached) revokeCoverUrl(cached.url);
    coverCache.set(slug, { key, url });
    return url;
  } catch (e) {
    handleError(e, { context: "library.cover.read" });
    // A transient read failure should not blank a cover that is already shown.
    return cached?.url ?? null;
  }
}

export const LIBRARY_ROOT = "/folio-library/library";

export function getLibraryManager(): LibraryManager {
  return new LibraryManager(getLibraryFs(), LIBRARY_ROOT);
}

function libraryManager(): LibraryManager {
  return getLibraryManager();
}

function coverMime(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

function rowFrom(
  doc: { id: string; slug: string; title: string; contentHash: string },
  meta: { author?: string | null; kind: "book" | "article" } | null,
  progress: Progress | null,
  coverUrl?: string | null,
): LibraryRow {
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    author: meta?.author ?? null,
    kind: meta?.kind ?? "book",
    percent: progress ? progress.percent : null,
    tint: tintIndexFromHash(doc.contentHash),
    coverUrl: coverUrl ?? getBookCoverPreset(doc.contentHash || doc.id),
  };
}

export const useLibraryUi = create<LibraryUiState>((set, get) => ({
  rows: [],
  loading: false,
  error: null,
  recovery: null,
  recoveryDialogOpen: false,
  duplicate: null,

  refresh: async () => {
    set({ loading: true, error: null });
    const nextCoverUrls: string[] = [];
    const usedCoverSlugs = new Set<string>();
    try {
      const lm = libraryManager();
      const manifest = await lm.load();
      const progress = await lm.progress.all();
      const rows: LibraryRow[] = [];
      for (const doc of manifest?.docs ?? []) {
        const meta = await lm.meta.read(doc.slug);
        let customCoverUrl: string | null = null;
        if (meta?.files?.cover) {
          usedCoverSlugs.add(doc.slug);
          customCoverUrl = await loadCoverUrl(doc.slug, meta.files.cover);
          if (customCoverUrl) nextCoverUrls.push(customCoverUrl);
        }
        rows.push(rowFrom(doc, meta, progress[doc.id] ?? null, customCoverUrl));
      }
      // recently read (default): progress.updatedAt desc, nulls last (06 §1.2)
      rows.sort((a, b) => {
        const au = progress[a.id]?.updatedAt ?? "";
        const bu = progress[b.id]?.updatedAt ?? "";
        if (au && bu) return bu.localeCompare(au);
        if (au) return -1;
        if (bu) return 1;
        return a.title.localeCompare(b.title);
      });
      const recovery = await lm.detectRecovery();
      // Swap rows first, then release covers that are no longer referenced.
      const stale = [...coverCache.entries()].filter(([slug]) => !usedCoverSlugs.has(slug));
      coverUrls = nextCoverUrls;
      set({
        rows,
        loading: false,
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
      set({ loading: false, error: message });
      pushToast({ tone: "error", text: message });
    }
  },

  importPicked: (files) => enqueueImport(files),

  resolveDuplicate: (r) => {
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

function enqueueImport(files: { name: string; bytes: Uint8Array }[]): Promise<ImportOutcome> {
  if (files.length === 0) {
    return Promise.resolve({ added: 0, skipped: 0, failures: [], title: null });
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

async function runImportBatch(
  files: { name: string; bytes: Uint8Array }[],
): Promise<ImportOutcome> {
  const lm = libraryManager();
  const multi = files.length > 1;
  let imported = 0;
  let replaced = 0;
  let skipped = 0;
  let lastTitle: string | null = null;
  const failures: string[] = [];

  try {
    for (const [index, file] of files.entries()) {
      pushToast({
        tone: "busy",
        text: multi
          ? `Importing ${index + 1} of ${files.length}: ${file.name}…`
          : `Importing ${file.name}…`,
      });
      try {
        const result: ImportResult = await importFile(
          lm,
          file.name,
          file.bytes,
          (title) =>
            new Promise<DuplicateResolution>((resolve) => {
              useLibraryUi.setState({ duplicate: { title, resolve } });
            }),
        );
        if (result.status === "imported") {
          imported += 1;
          lastTitle = result.title ?? file.name;
        } else if (result.status === "replaced") {
          replaced += 1;
          lastTitle = result.title ?? file.name;
        } else if (result.status === "skipped") {
          skipped += 1;
          lastTitle = result.title ?? file.name;
        } else {
          failures.push(`${file.name}: ${result.error ?? "Import failed"}`);
        }
      } catch (e) {
        handleError(e, { context: "library.import" });
        failures.push(`${file.name}: ${e instanceof Error ? e.message : "Import failed"}`);
      }
    }
  } finally {
    // Always reconcile the shelf, even when every file failed.
    await useLibraryUi.getState().refresh();
  }

  const refreshError = useLibraryUi.getState().error;
  const details = refreshError ? [...failures, `Library refresh: ${refreshError}`] : failures;
  const added = imported + replaced;
  const outcome: ImportOutcome = { added, skipped, failures, title: lastTitle };

  if (!multi) {
    if (failures.length > 0) {
      pushToast({ tone: "error", text: "Import failed", details });
      return outcome;
    }
    if (skipped === 1) {
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
  if (refreshError) parts.push("refresh failed");

  pushToast({
    tone: failures.length > 0 || refreshError ? "error" : "success",
    text: parts.join(", "),
    details: details.length > 0 ? details : undefined,
  });
  return outcome;
}
