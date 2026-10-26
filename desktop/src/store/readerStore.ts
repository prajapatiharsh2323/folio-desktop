// Reader session: loads the book, its appearance and progress through the same
// schema-1 repositories the library uses. Keeps blob URLs and load races out of
// the screen component.
import { create } from "zustand";
import { getLibraryFs, getLibraryManager, LIBRARY_ROOT } from "./libraryUi";
import { libraryLayout as L } from "../lib/libraryPaths";
import type { DocMeta, Progress, ReadingPrefs } from "../model/types";
import { nowIso } from "../model/ids";
import type { ReaderOpenRequest } from "./routeStore";
import type { PaceState } from "../reader/pace";

export interface ReaderDoc {
  docId: string;
  slug: string;
  title: string;
  author: string | null;
  meta: DocMeta;
  epubBytes: Uint8Array;
  prefs: ReadingPrefs;
  progress: Progress | null;
  /** object URL for cover.*, or null when the book has no cover file */
  coverUrl: string | null;
}

export type ReaderStatus = "idle" | "loading" | "ready" | "error";

interface ReaderState {
  status: ReaderStatus;
  error: string | null;
  doc: ReaderDoc | null;
  request: ReaderOpenRequest | null;
  load: (request: ReaderOpenRequest) => Promise<void>;
  close: () => void;
  savePrefs: (next: ReadingPrefs) => Promise<void>;
  resetPrefs: () => Promise<void>;
  persistProgress: (snapshot: {
    location: string;
    percent: number;
    pace?: PaceState | null;
  }) => Promise<void>;
}

let loadToken = 0;

export const useReaderStore = create<ReaderState>((set, get) => ({
  status: "idle",
  error: null,
  doc: null,
  request: null,

  load: async (request) => {
    const token = ++loadToken;
    const previous = get().doc;
    if (previous?.coverUrl) URL.revokeObjectURL(previous.coverUrl);
    set({ status: "loading", error: null, doc: null, request });

    try {
      const lm = getLibraryManager();
      const manifest = await lm.load();
      const entry = manifest?.docs.find((d) => d.id === request.docId);
      if (!entry) throw new Error("This document is no longer in your library");
      const meta = await lm.meta.read(entry.slug);
      if (!meta) throw new Error("This book's metadata is damaged");

      const fs = getLibraryFs();
      const readingPath =
        meta.files.reading ?? "reading/book.epub";
      const epubBytes = await fs.readBytes(
        `${L.docDir(LIBRARY_ROOT, entry.slug)}/${readingPath.replace(/^\/+/, "")}`
      );

      const [prefs, progress] = await Promise.all([
        lm.prefs.resolved(request.docId),
        lm.progress.get(request.docId),
      ]);

      let coverUrl: string | null = null;
      if (meta.files.cover) {
        try {
          const coverBytes = await fs.readBytes(
            `${L.docDir(LIBRARY_ROOT, entry.slug)}/${meta.files.cover.replace(/^\/+/, "")}`
          );
          coverUrl = URL.createObjectURL(
            new Blob([coverBytes as BlobPart], { type: coverMime(meta.files.cover) })
          );
        } catch {
          coverUrl = null;
        }
      }

      if (token !== loadToken) {
        if (coverUrl) URL.revokeObjectURL(coverUrl);
        return;
      }

      set({
        status: "ready",
        error: null,
        doc: {
          docId: request.docId,
          slug: entry.slug,
          title: meta.title || entry.title,
          author: meta.author ?? null,
          meta,
          epubBytes,
          prefs,
          progress,
          coverUrl,
        },
      });
    } catch (error) {
      if (token !== loadToken) return;
      set({
        status: "error",
        error: error instanceof Error ? error.message : "This book can't be opened",
        doc: null,
      });
    }
  },

  close: () => {
    loadToken += 1;
    const doc = get().doc;
    if (doc?.coverUrl) URL.revokeObjectURL(doc.coverUrl);
    set({ status: "idle", error: null, doc: null, request: null });
  },

  savePrefs: async (next) => {
    const doc = get().doc;
    if (!doc) return;
    await getLibraryManager().prefs.writeDocOverride(doc.docId, next);
    set({ doc: { ...doc, prefs: next } });
  },

  resetPrefs: async () => {
    const doc = get().doc;
    if (!doc) return;
    const lm = getLibraryManager();
    await lm.prefs.removeDocOverride(doc.docId);
    const prefs = await lm.prefs.global();
    set({ doc: { ...doc, prefs } });
  },

  persistProgress: async (snapshot) => {
    const doc = get().doc;
    if (!doc) return;
    const progress: Progress = {
      docId: doc.docId,
      location: snapshot.location,
      percent: snapshot.percent,
      updatedAt: nowIso(),
      pace: snapshot.pace ?? doc.progress?.pace ?? null,
    };
    await getLibraryManager().progress.put(progress);
    const latest = get().doc;
    if (latest && latest.docId === doc.docId) {
      set({ doc: { ...latest, progress } });
    }
  },
}));

function coverMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}
