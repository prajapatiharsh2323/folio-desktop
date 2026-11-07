// Library UI state: rows (manifest + progress), import with duplicate gate,
// recovery banners (06 §1). Persists through the Tauri FileStore when available,
// Memory store in browser dev.
import { create } from "zustand";
import { MemoryFileStore, TauriFileStore, type FileStore } from "../lib/fileStore";
import { LibraryManager } from "./libraryManager";
import { importFile, type DuplicateResolution, type ImportResult } from "../import/importService";
import { tintIndexFromHash } from "../import/cover";
import { getBookCoverPreset } from "../lib/coverPresets";
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

interface Snackbar {
  tone: "busy" | "success" | "error";
  text: string;
}

interface LibraryUiState {
  rows: LibraryRow[];
  loading: boolean;
  error: string | null;
  recovery: RecoveryInfo | null;
  recoveryDialogOpen: boolean;
  duplicate: { title: string; resolve: (r: DuplicateResolution) => void } | null;
  snackbar: Snackbar | null;
  refresh: () => Promise<void>;
  importPicked: (files: { name: string; bytes: Uint8Array }[]) => Promise<void>;
  resolveDuplicate: (r: DuplicateResolution) => void;
  dismissSnackbar: () => void;
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
  coverUrl?: string | null
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
  snackbar: null,

  refresh: async () => {
    set({ loading: true, error: null });
    const nextCoverUrls: string[] = [];
    try {
      const lm = libraryManager();
      const manifest = await lm.load();
      const progress = await lm.progress.all();
      const rows: LibraryRow[] = [];
      for (const doc of manifest?.docs ?? []) {
        const meta = await lm.meta.read(doc.slug);
        let customCoverUrl: string | null = null;
        if (meta?.files?.cover) {
          try {
            const coverBytes = await getLibraryFs().readBytes(
              `${LIBRARY_ROOT}/docs/${doc.slug}/${meta.files.cover.replace(/^\/+/, "")}`
            );
            if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
              customCoverUrl = URL.createObjectURL(
                new Blob([coverBytes as BlobPart], { type: coverMime(meta.files.cover) })
              );
              nextCoverUrls.push(customCoverUrl);
            }
          } catch {
            customCoverUrl = null;
          }
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
      // Swap rows first, then release any URL the new batch does not use.
      const stale = coverUrls.filter((url) => !nextCoverUrls.includes(url));
      coverUrls = nextCoverUrls;
      set({
        rows,
        loading: false,
        error: null,
        recovery:
          recovery.damaged.length > 0 || recovery.interrupted.length > 0 ? recovery : null,
      });
      for (const url of stale) {
        // Let React commit the new rows before releasing the previous batch.
        // A macrotask runs after React's microtask flush; releasing inside a
        // microtask could blank an image that is still on screen.
        setTimeout(() => revokeCoverUrl(url), 0);
      }
    } catch (e) {
      // A failed refresh never owns its newly created URLs.
      for (const url of nextCoverUrls) revokeCoverUrl(url);
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Library load failed",
        snackbar: { tone: "error", text: e instanceof Error ? e.message : "Load failed" },
      });
    }
  },

  importPicked: async (files) => {
    if (files.length === 0) return;
    const lm = libraryManager();
    for (const f of files) {
      set({ snackbar: { tone: "busy", text: `Importing ${f.name}…` } });
      const result: ImportResult = await importFile(lm, f.name, f.bytes, (title) => {
        return new Promise<DuplicateResolution>((resolve) => {
          set({ duplicate: { title, resolve } });
        });
      });
      if (result.status === "imported" || result.status === "replaced") {
        set({
          snackbar: {
            tone: "success",
            text:
              result.status === "replaced"
                ? `Replaced “${result.title}”`
                : `Imported “${result.title}”`,
          },
        });
      } else if (result.status === "skipped") {
        set({ snackbar: { tone: "success", text: "Already in your library — skipped" } });
      } else {
        set({ snackbar: { tone: "error", text: result.error ?? "Import failed" } });
      }
    }
    await get().refresh();
  },

  resolveDuplicate: (r) => {
    const dup = get().duplicate;
    set({ duplicate: null });
    dup?.resolve(r);
  },

  dismissSnackbar: () => set({ snackbar: null }),

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
