// Library UI state: rows (manifest + progress), import with duplicate gate,
// recovery banners (06 §1). Persists through the Tauri FileStore when available,
// Memory store in browser dev.
import { create } from "zustand";
import { MemoryFileStore, TauriFileStore, type FileStore } from "../lib/fileStore";
import { LibraryManager } from "./libraryManager";
import { importFile, type DuplicateResolution, type ImportResult } from "../import/importService";
import { tintIndexFromHash } from "../import/cover";
import type { Progress } from "../model/types";

export interface LibraryRow {
  id: string;
  slug: string;
  title: string;
  author?: string | null;
  kind: "book" | "article";
  percent: number | null; // null → "New"
  tint: number;
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

export const LIBRARY_ROOT = "/folio-library/library";

export function getLibraryManager(): LibraryManager {
  return new LibraryManager(getLibraryFs(), LIBRARY_ROOT);
}

function libraryManager(): LibraryManager {
  return getLibraryManager();
}

function rowFrom(
  doc: { id: string; slug: string; title: string; contentHash: string },
  meta: { author?: string | null; kind: "book" | "article" } | null,
  progress: Progress | null
): LibraryRow {
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    author: meta?.author ?? null,
    kind: meta?.kind ?? "book",
    percent: progress ? progress.percent : null,
    tint: tintIndexFromHash(doc.contentHash),
  };
}

export const useLibraryUi = create<LibraryUiState>((set, get) => ({
  rows: [],
  loading: false,
  recovery: null,
  recoveryDialogOpen: false,
  duplicate: null,
  snackbar: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const lm = libraryManager();
      const manifest = await lm.load();
      const progress = await lm.progress.all();
      const rows: LibraryRow[] = [];
      for (const doc of manifest?.docs ?? []) {
        const meta = await lm.meta.read(doc.slug);
        rows.push(rowFrom(doc, meta, progress[doc.id] ?? null));
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
      set({
        rows,
        loading: false,
        recovery:
          recovery.damaged.length > 0 || recovery.interrupted.length > 0 ? recovery : null,
      });
    } catch (e) {
      set({
        loading: false,
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
