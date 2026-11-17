// FileStore-backed repositories for the schema-1 user files (05 §2).
import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { readJsonAsync, writeJsonAtomic } from "./jsonio";
import type { Annotation, Collection, Manifest, Progress, ReadingPrefs } from "../model/types";
import { DEFAULT_READING_PREFS } from "../model/defaults";

/** Merge known fields onto the raw parsed record, preserving unknown keys. */
function mergePreserve<T extends object>(raw: unknown, patch: Partial<T>): T {
  if (raw && typeof raw === "object") {
    return { ...(raw as object), ...(patch as object) } as T;
  }
  return { ...(patch as object) } as T;
}

export class ManifestRepo {
  constructor(
    private fs: FileStore,
    private root: string,
  ) {}

  path(): string {
    return L.manifest(this.root);
  }

  async read(): Promise<Manifest | null> {
    return readJsonAsync<Manifest>(this.fs, this.path());
  }

  /** Atomic manifest rewrite — the commit point (05 §4 invariant 2). */
  async write(manifest: Manifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.fs, this.path(), manifest);
  }
}

export class AnnotationsRepo {
  constructor(
    private fs: FileStore,
    private root: string,
  ) {}

  private p(): string {
    return L.annotations(this.root);
  }

  async list(): Promise<Annotation[]> {
    const raw = await readJsonAsync<unknown[]>(this.fs, this.p());
    return Array.isArray(raw) ? (raw as Annotation[]) : [];
  }

  async listForDoc(docId: string): Promise<Annotation[]> {
    return (await this.list()).filter((a) => a.docId === docId);
  }

  async add(a: Annotation): Promise<void> {
    const list = await this.list();
    list.push(a);
    await this.writeAll(list);
  }

  /** Update by id, preserving unknown keys on the record. */
  async update(id: string, patch: Partial<Annotation>): Promise<void> {
    const list = await this.list();
    const idx = list.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error(`annotation not found: ${id}`);
    list[idx] = mergePreserve<Annotation>(list[idx], patch);
    await this.writeAll(list);
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.list();
    const next = list.filter((a) => a.id !== id);
    if (next.length === list.length) return false;
    await this.writeAll(next);
    return true;
  }

  /** Used by cascade deletion — drops all annotations of a doc. */
  async removeAllForDoc(docId: string): Promise<void> {
    const list = await this.list();
    const next = list.filter((a) => a.docId !== docId);
    if (next.length !== list.length) await this.writeAll(next);
  }

  async writeAll(list: Annotation[]): Promise<void> {
    await writeJsonAtomic(this.fs, this.p(), list);
  }
}

export class ProgressRepo {
  constructor(
    private fs: FileStore,
    private root: string,
  ) {}

  private p(): string {
    return L.progress(this.root);
  }

  async all(): Promise<Record<string, Progress>> {
    const raw = await readJsonAsync<Record<string, Progress>>(this.fs, this.p());
    return raw && typeof raw === "object" ? raw : {};
  }

  async get(docId: string): Promise<Progress | null> {
    return (await this.all())[docId] ?? null;
  }

  /** Upsert one doc's progress, preserving unknown keys of other records. */
  async put(progress: Progress): Promise<void> {
    const all = await this.all();
    const raw = await readJsonAsync<Record<string, unknown>>(this.fs, this.p());
    all[progress.docId] = mergePreserve<Progress>(raw?.[progress.docId], progress);
    await writeJsonAtomic(this.fs, this.p(), all);
  }

  async removeForDoc(docId: string): Promise<void> {
    const all = await this.all();
    if (docId in all) {
      delete all[docId];
      await writeJsonAtomic(this.fs, this.p(), all);
    }
  }
}

export class CollectionsRepo {
  constructor(
    private fs: FileStore,
    private root: string,
  ) {}

  private p(): string {
    return L.collections(this.root);
  }

  async list(): Promise<Collection[]> {
    const raw = await readJsonAsync<unknown[]>(this.fs, this.p());
    return Array.isArray(raw) ? (raw as Collection[]) : [];
  }

  async save(collections: Collection[]): Promise<void> {
    await writeJsonAtomic(this.fs, this.p(), collections);
  }

  /** Add a doc to a collection, preserving unknown keys on the collection. */
  async addToCollection(collectionId: string, docId: string): Promise<void> {
    const list = await this.list();
    const c = list.find((x) => x.id === collectionId);
    if (!c) throw new Error(`collection not found: ${collectionId}`);
    if (!c.docIds.includes(docId)) c.docIds.push(docId);
    c.updatedAt = new Date().toISOString();
    await this.save(list);
  }

  async removeFromCollection(collectionId: string, docId: string): Promise<void> {
    const list = await this.list();
    const c = list.find((x) => x.id === collectionId);
    if (!c) return;
    c.docIds = c.docIds.filter((id) => id !== docId);
    c.updatedAt = new Date().toISOString();
    await this.save(list);
  }

  async remove(collectionId: string): Promise<void> {
    const list = await this.list();
    await this.save(list.filter((c) => c.id !== collectionId));
  }
}

/**
 * F2 (Phase 5): daily reading log (`user/reading-log.json`). Additive file —
 * the day and per-doc buckets accumulate credited reading time (the same
 * wall-clock `ReadingPaceStats` credits, so idle/skip time never lands here),
 * written through the progress-flush cadence. Unknown keys of the file and of
 * each day record are preserved on rewrite, and the file backs up with the
 * rest of `user/**`.
 */
export interface ReadingLogDay {
  /** Credited reading time for the local day, in ms. */
  ms: number;
  /** Optional per-doc split (docId → ms); trimmed on doc deletion. */
  perDoc?: Record<string, number>;
}

export interface ReadingLogFile {
  schema: 1;
  days: Record<string, ReadingLogDay>;
}

export class ReadingLogRepo {
  constructor(
    private fs: FileStore,
    private root: string,
  ) {}

  private p(): string {
    return L.readingLog(this.root);
  }

  private async readRaw(): Promise<Record<string, unknown>> {
    const raw = await readJsonAsync<Record<string, unknown>>(this.fs, this.p());
    return raw && typeof raw === "object" ? raw : {};
  }

  async all(): Promise<ReadingLogFile> {
    const raw = await this.readRaw();
    const days =
      raw.days && typeof raw.days === "object" ? (raw.days as ReadingLogFile["days"]) : {};
    return { schema: 1, days };
  }

  /** Credit `deltaMs` of reading to `docId` on the local day `dateKey`.
   *  Non-positive deltas are ignored (the log only ever grows). */
  async addMs(dateKey: string, docId: string, deltaMs: number): Promise<void> {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    const raw = await this.readRaw();
    const days: Record<string, ReadingLogDay> =
      raw.days && typeof raw.days === "object"
        ? { ...(raw.days as Record<string, ReadingLogDay>) }
        : {};
    const prev: ReadingLogDay =
      days[dateKey] && typeof days[dateKey] === "object"
        ? (days[dateKey] as ReadingLogDay)
        : { ms: 0 };
    const perDoc = { ...(prev.perDoc ?? {}) };
    perDoc[docId] = (perDoc[docId] ?? 0) + deltaMs;
    // Round-trip through numbers so stale fractional drift can't accumulate.
    const total = Math.round((prev.ms ?? 0) + deltaMs);
    days[dateKey] = { ...prev, ms: total, perDoc };
    await writeJsonAtomic(this.fs, this.p(), { ...raw, schema: 1, days });
  }

  /** Cascade-deletion hygiene: drop a doc from every perDoc bucket. */
  async removeDoc(docId: string): Promise<void> {
    const raw = await this.readRaw();
    const days = raw.days;
    if (!days || typeof days !== "object") return;
    let changed = false;
    const next: Record<string, ReadingLogDay> = {};
    for (const [key, day] of Object.entries(days as Record<string, ReadingLogDay>)) {
      if (day?.perDoc && docId in day.perDoc) {
        const perDoc = { ...day.perDoc };
        delete perDoc[docId];
        next[key] = Object.keys(perDoc).length === 0 ? { ms: day.ms } : { ...day, perDoc };
        changed = true;
      } else {
        next[key] = day;
      }
    }
    if (changed) await writeJsonAtomic(this.fs, this.p(), { ...raw, days: next });
  }
}

export class PrefsRepo {
  constructor(
    private fs: FileStore,
    private root: string,
  ) {}

  /** Global ReadingPrefs (user/settings.json). */
  async global(): Promise<ReadingPrefs> {
    const raw = await readJsonAsync<Partial<ReadingPrefs>>(this.fs, L.settings(this.root));
    return { ...DEFAULT_READING_PREFS, ...(raw ?? {}) };
  }

  async writeGlobal(prefs: ReadingPrefs): Promise<void> {
    await writeJsonAtomic(this.fs, L.settings(this.root), prefs);
  }

  /** Per-doc overrides (user/doc-settings.json). Missing → null. */
  async docOverride(docId: string): Promise<ReadingPrefs | null> {
    const all = await readJsonAsync<Record<string, ReadingPrefs>>(
      this.fs,
      L.docSettings(this.root),
    );
    return all?.[docId] ?? null;
  }

  async allDocOverrides(): Promise<Record<string, ReadingPrefs>> {
    const all = await readJsonAsync<Record<string, ReadingPrefs>>(
      this.fs,
      L.docSettings(this.root),
    );
    return all ?? {};
  }

  async writeDocOverride(docId: string, prefs: ReadingPrefs): Promise<void> {
    const all = await this.allDocOverrides();
    all[docId] = prefs;
    await writeJsonAtomic(this.fs, L.docSettings(this.root), all);
  }

  /** "Reset to defaults" removes ONLY this doc's override (04 §3). */
  async removeDocOverride(docId: string): Promise<void> {
    const all = await this.allDocOverrides();
    if (docId in all) {
      delete all[docId];
      await writeJsonAtomic(this.fs, L.docSettings(this.root), all);
    }
  }

  /** Merge doc override over global defaults (04 §1 step 3). */
  async resolved(docId: string): Promise<ReadingPrefs> {
    const g = await this.global();
    const o = await this.docOverride(docId);
    return o ? { ...g, ...o } : g;
  }
}
