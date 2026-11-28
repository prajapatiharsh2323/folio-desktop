// Background page-text index for PDFs (PDF plan §6.4). One file per document:
// `index/text/<docId>.json` in the same schema-1 shape as EPUB indexes, with
// one entry per page (id "p<n>", href "page-<n>"). Derived data — never part
// of backups; `reconcileIndexes` recovers anything lost to a crash.
//
// Queue: single concurrency. Extraction runs one page at a time and yields to
// the UI between pages; the job is cancelled when the document is deleted and
// re-checks the manifest before writing.
import { create } from "zustand";
import { getLibraryFs, getLibraryManager, LIBRARY_ROOT } from "../store/libraryUi";
import { libraryLayout as L } from "../lib/libraryPaths";
import type { Manifest } from "../model/types";
import { openPdf, type OpenedPdf } from "./pdfjsAdapter";
import { extractPageText } from "./pdfText";
import { bumpSearchIndexGeneration } from "../lib/searchCache";

export interface PdfIndexEntry {
  id: string;
  title: string;
  order: number;
  href: string;
  text: string;
}

export interface IndexJob {
  docId: string;
  title: string;
  /** "queued" until extraction starts, then pages flow in */
  phase: "queued" | "running";
  /** pages extracted so far (for the Library status line) */
  done: number;
  total: number;
}

interface IndexJobsState {
  jobs: Record<string, IndexJob>;
  start: (job: IndexJob) => void;
  progress: (docId: string, done: number, total: number) => void;
  finish: (docId: string) => void;
}

/** Quiet progress surface for the Library toolbar ("Indexing 'Title' 40%"). */
export const useIndexJobs = create<IndexJobsState>((set) => ({
  jobs: {},
  start: (job) => set((s) => ({ jobs: { ...s.jobs, [job.docId]: job } })),
  progress: (docId, done, total) =>
    set((s) => {
      const job = s.jobs[docId];
      if (!job) return s;
      return { jobs: { ...s.jobs, [docId]: { ...job, done, total } } };
    }),
  finish: (docId) =>
    set((s) => {
      const jobs = { ...s.jobs };
      delete jobs[docId];
      return { jobs };
    }),
}));

/** Extract page text for every page of an opened PDF (plan §6.4): one page at
 *  a time, yielding to the UI between pages. Returns schema-1 index entries. */
export async function buildPdfIndexEntries(
  opened: OpenedPdf,
  onPage?: (done: number, total: number, text: string) => void | Promise<void>,
): Promise<{ pageCount: number; entries: PdfIndexEntry[] }> {
  const { doc } = opened;
  const pageCount = doc.numPages;
  const entries: PdfIndexEntry[] = [];
  for (let i = 1; i <= pageCount; i++) {
    let text: string;
    try {
      const page = await doc.getPage(i);
      text = await extractPageText(page);
      page.cleanup();
    } catch {
      text = ""; // a single unreadable page must not kill the index
    }
    const entry: PdfIndexEntry = {
      id: `p${i}`,
      title: `Page ${i}`,
      order: i - 1,
      href: `page-${i}`,
      text,
    };
    entries.push(entry);
    if (onPage) await onPage(i, pageCount, text);
    // Yield to the UI between pages (plan §6.4).
    await Promise.resolve();
  }
  return { pageCount, entries };
}

/** Serialise the whole job queue: one index job at a time. Each run gets a
 *  token; `cancelIndex` marks the *current* run's token cancelled — a later
 *  enqueue starts a fresh token, so cancel-then-re-enqueue behaves sanely. */
let queueTail: Promise<void> = Promise.resolve();
const tokens = new Map<string, { cancelled: boolean }>();

/** Resolves when every currently enqueued job has settled (tests + boot). */
export function indexQueueIdle(): Promise<void> {
  return queueTail.then(
    () => undefined,
    () => undefined,
  );
}

export function cancelIndex(docId: string): void {
  const token = tokens.get(docId);
  if (token) token.cancelled = true;
}

export function isIndexQueued(docId: string): boolean {
  return useIndexJobs.getState().jobs[docId] !== undefined;
}

/** Enqueue an index build for one PDF document (fire and forget). */
export function enqueueIndex(docId: string): void {
  const token = { cancelled: false };
  tokens.set(docId, token);
  // Register synchronously so the Library can show "Queued" immediately and
  // reconcile's isIndexQueued() guard sees the pending run.
  useIndexJobs.getState().start({
    docId,
    title: "",
    phase: "queued",
    done: 0,
    total: 0,
  });
  queueTail = queueTail
    .then(() => runIndexJob(docId, token))
    .catch((error) => {
      // Job failures are logged, not surfaced: library search simply keeps
      // skipping the document ("no index yet") until reconcile retries.
      if (!(error instanceof CanceledError)) {
        console.error(`[pdfIndexJob] ${docId}`, error);
      }
      useIndexJobs.getState().finish(docId);
    });
}

async function runIndexJob(docId: string, token: { cancelled: boolean }): Promise<void> {
  try {
    const lm = getLibraryManager();
    const fs = getLibraryFs();

    const manifest = await lm.load();
    const entry = manifest?.docs.find((d) => d.id === docId);
    if (!entry || token.cancelled) return; // deleted / cancelled while queued
    const meta = await lm.meta.read(entry.slug);
    if (!meta || meta.sourceFormat !== "pdf") return;

    const readingPath = (meta.files.reading ?? "reading/book.pdf").replace(/^\/+/, "");
    const bytes = await fs.readBytes(`${L.docDir(LIBRARY_ROOT, entry.slug)}/${readingPath}`);

    useIndexJobs.getState().start({
      docId,
      title: meta.title || entry.title,
      phase: "running",
      done: 0,
      total: 0,
    });

    const opened = await openPdf(bytes);
    let entries: PdfIndexEntry[];
    try {
      const built = await buildPdfIndexEntries(opened, (done, total) => {
        if (token.cancelled) throw new CanceledError(docId);
        useIndexJobs.getState().progress(docId, done, total);
      });
      entries = built.entries;
    } finally {
      await opened.destroy().catch(() => {});
    }

    // Re-check before writing: the document may have been deleted mid-job.
    if (token.cancelled) return;
    const fresh = await lm.load();
    if (!fresh?.docs.some((d) => d.id === docId)) return;

    // Write atomically once at the end (plan §6.4). Same schema-1 shape as the
    // EPUB index, with outline titles where the document has them
    // (meta.chapters is keyed by href page-N).
    const titleByHref = new Map(meta.chapters.map((c) => [c.href, c.title]));
    const index = {
      schema: 1 as const,
      chapters: entries.map((e) => ({
        id: e.id,
        title: titleByHref.get(e.href) ?? e.title,
        order: e.order,
        href: e.href,
        text: e.text,
      })),
    };
    await fs.writeBytesAtomic(
      L.indexText(LIBRARY_ROOT, docId),
      new TextEncoder().encode(JSON.stringify(index)),
    );
    bumpSearchIndexGeneration();
  } finally {
    // Every exit path clears the Library's job entry (cancelled, deleted,
    // failed, or done).
    useIndexJobs.getState().finish(docId);
  }
}

class CanceledError extends Error {
  constructor(docId: string) {
    super(`index job cancelled: ${docId}`);
    this.name = "CanceledError";
  }
}

/** Boot-time crash recovery: enqueue every PDF whose index file is missing
 *  (plan §6.4). Called after useBoot refreshes the library. */
export async function reconcileIndexes(): Promise<number> {
  const lm = getLibraryManager();
  const fs = getLibraryFs();
  const manifest = (await lm.load()) as Manifest | null;
  if (!manifest) return 0;
  let enqueued = 0;
  for (const doc of manifest.docs) {
    const meta = await lm.meta.read(doc.slug);
    if (!meta || meta.sourceFormat !== "pdf" || meta.searchable === false) continue;
    const indexPath = L.indexText(LIBRARY_ROOT, doc.id);
    if (await fs.exists(indexPath)) continue;
    if (isIndexQueued(doc.id)) continue;
    enqueueIndex(doc.id);
    enqueued += 1;
  }
  return enqueued;
}
