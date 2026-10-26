// LibraryManager — the sticky mutation rules from 05 §4:
//   1. dual-write collection.docIds ↔ docMeta.collectionIds via shared mutators
//   2. manifest.json is the commit point, written LAST on any doc mutation
//   3. doc deletion cascades through folder/progress/annotations/collections/index
//   4. a process-wide mutex serializes write batches (never 2 concurrent manifest rewrites)
import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { ManifestRepo } from "./repos";
import { DocMetaRepo } from "./docMetaRepo";
import {
  AnnotationsRepo,
  CollectionsRepo,
  PrefsRepo,
  ProgressRepo,
} from "./repos";
import type { Collection, DocMeta, Manifest, ManifestDoc, ManifestFile } from "../model/types";
import { newUuid, nowIso, resolveSlugConflict, slugify } from "../model/ids";
import { runExclusive } from "../lib/writeLock";
import { sha256Hex } from "../lib/sha256";

export interface AddDocInput {
  meta: DocMeta;
  /** doc-folder-relative → bytes (original/, reading/, clean/, cover.*). */
  files: Record<string, Uint8Array>;
  /** doc-folder-relative paths already written by the pipeline (e.g. cover.png). */
}

export class LibraryManager {
  readonly manifest: ManifestRepo;
  readonly meta: DocMetaRepo;
  readonly annotations: AnnotationsRepo;
  readonly progress: ProgressRepo;
  readonly collections: CollectionsRepo;
  readonly prefs: PrefsRepo;

  constructor(
    private fs: FileStore,
    readonly root: string
  ) {
    this.manifest = new ManifestRepo(fs, root);
    this.meta = new DocMetaRepo(fs, root);
    this.annotations = new AnnotationsRepo(fs, root);
    this.progress = new ProgressRepo(fs, root);
    this.collections = new CollectionsRepo(fs, root);
    this.prefs = new PrefsRepo(fs, root);
  }

  /** Read manifest; null when missing/unreadable → caller enters Recovery. */
  async load(): Promise<Manifest | null> {
    return this.manifest.read();
  }

  /** Low-level byte write (index cache, cover, etc.). */
  async writeFileAtomic(absPath: string, bytes: Uint8Array): Promise<void> {
    await this.fs.writeBytesAtomic(absPath, bytes);
  }

  /** Remove a folder tree without touching manifest/user files. */
  async deleteFolderOnly(absPath: string): Promise<void> {
    await this.fs.delete(absPath);
  }

  /** Import commit: write doc files + meta.json, then rebuild manifest LAST. */
  async addDoc(input: AddDocInput): Promise<Manifest> {
    const existingSlugs = await this.meta.listSlugs();
    const base = slugify(input.meta.title);
    const slug = input.meta.slug || resolveSlugConflict(base, existingSlugs);
    input.meta.slug = slug;

    return runExclusive(async () => {
      // 1) data files first (05 §4 invariant 2)
      const docFiles: ManifestFile[] = [];
      const dir = L.docDir(this.root, slug);
      for (const [rel, bytes] of Object.entries(input.files)) {
        const abs = `${dir}/${rel}`;
        await this.fs.writeBytesAtomic(abs, bytes);
        docFiles.push(await this.fileEntry(`docs/${slug}/${rel}`));
      }
      // meta.json after data files
      await this.meta.write(slug, input.meta);
      docFiles.push(await this.fileEntry(`docs/${slug}/meta.json`));

      // 2) manifest rebuilt last (commit point)
      const manifest = (await this.manifest.read()) ?? this.emptyManifest();
      const doc: ManifestDoc = {
        id: input.meta.id,
        slug,
        title: input.meta.title,
        contentHash: input.meta.contentHash,
        updatedAt: nowIso(),
        files: docFiles,
      };
      manifest.docs = manifest.docs.filter((d) => d.id !== input.meta.id);
      manifest.docs.push(doc);
      await this.manifest.write(manifest);
      return manifest;
    });
  }

  /** Deletion cascade (05 §4 invariant 3): folder → user files → manifest last. */
  async deleteDoc(docId: string): Promise<void> {
    return runExclusive(async () => {
      const manifest = await this.manifest.read();
      const doc = manifest?.docs.find((d) => d.id === docId);
      if (!doc) throw new Error(`doc not found in manifest: ${docId}`);

      // 1) remove folder recursively
      await this.fs.delete(L.docDir(this.root, doc.slug));
      // 2) index cache
      await this.fs.delete(L.indexText(this.root, docId));
      // 3) user files
      await this.annotations.removeAllForDoc(docId);
      await this.progress.removeForDoc(docId);
      const collections = await this.collections.list();
      let collectionsChanged = false;
      for (const c of collections) {
        if (c.docIds.includes(docId)) {
          c.docIds = c.docIds.filter((id) => id !== docId);
          c.updatedAt = nowIso();
          collectionsChanged = true;
        }
      }
      if (collectionsChanged) await this.collections.save(collections);
      // per-doc settings override removal
      await this.prefs.removeDocOverride(docId);
      // 4) manifest last
      if (manifest) {
        manifest.docs = manifest.docs.filter((d) => d.id !== docId);
        await this.manifest.write(manifest);
      }
    });
  }

  /** Dual-write: set a doc's collections on both sides through one mutator (05 §4.1). */
  async setDocCollections(docId: string, collectionIds: string[]): Promise<void> {
    return runExclusive(async () => {
      const manifest = await this.manifest.read();
      const doc = manifest?.docs.find((d) => d.id === docId);
      if (!doc) throw new Error(`doc not found in manifest: ${docId}`);

      // docmeta side (mergePreserve of unknown keys happens in write path)
      const meta = await this.meta.read(doc.slug);
      if (!meta) throw new Error(`meta.json missing for slug: ${doc.slug}`);
      meta.collectionIds = [...collectionIds];
      await this.meta.write(doc.slug, meta);

      // collections side: add/remove doc membership to match
      const collections = await this.collections.list();
      const now = nowIso();
      for (const c of collections) {
        const shouldHave = collectionIds.includes(c.id);
        const has = c.docIds.includes(docId);
        if (shouldHave && !has) {
          c.docIds.push(docId);
          c.updatedAt = now;
        } else if (!shouldHave && has) {
          c.docIds = c.docIds.filter((id) => id !== docId);
          c.updatedAt = now;
        }
      }
      await this.collections.save(collections);

      // manifest file hash changed for meta.json → rewrite manifest last
      if (manifest) {
        const entry = await this.fileEntry(`docs/${doc.slug}/meta.json`);
        doc.files = doc.files.filter((f) => f.path !== entry.path);
        doc.files.push(entry);
        doc.updatedAt = nowIso();
        await this.manifest.write(manifest);
      }
    });
  }

  /** Dual-write counterpart: mutate a collection's membership (add/remove doc). */
  async mutateCollectionDocs(
    collectionId: string,
    op: { add?: string[]; remove?: string[] }
  ): Promise<Collection> {
    return runExclusive(async () => {
      const collections = await this.collections.list();
      let c = collections.find((x) => x.id === collectionId);
      if (!c) {
        throw new Error(`collection not found: ${collectionId}`);
      }
      const now = nowIso();
      const slugsByDoc = new Map<string, string>();
      for (const d of (await this.manifest.read())?.docs ?? []) slugsByDoc.set(d.id, d.slug);

      for (const id of op.add ?? []) {
        if (!c.docIds.includes(id)) c.docIds.push(id);
        await this.applyDocSide(slugsByDoc.get(id), id, (ids) => {
          if (!ids.includes(collectionId)) ids.push(collectionId);
        });
      }
      for (const id of op.remove ?? []) {
        c.docIds = c.docIds.filter((x) => x !== id);
        await this.applyDocSide(slugsByDoc.get(id), id, (ids) => {
          const i = ids.indexOf(collectionId);
          if (i >= 0) ids.splice(i, 1);
        });
      }
      c.updatedAt = now;
      await this.collections.save(collections);

      // manifest last (meta.json files changed for every touched doc)
      const manifest = await this.manifest.read();
      if (manifest) {
        const touched = [...(op.add ?? []), ...(op.remove ?? [])];
        for (const id of touched) {
          const md = manifest.docs.find((d) => d.id === id);
          const slug = slugsByDoc.get(id);
          if (md && slug) {
            const entry = await this.fileEntry(`docs/${slug}/meta.json`);
            md.files = md.files.filter((f) => f.path !== entry.path);
            md.files.push(entry);
            md.updatedAt = nowIso();
          }
        }
        await this.manifest.write(manifest);
      }
      return c;
    });
  }

  async createCollection(name: string): Promise<Collection> {
    return runExclusive(async () => {
      const c: Collection = {
        id: newUuid(),
        name,
        docIds: [],
        createdAt: nowIso(),
        updatedAt: null,
      };
      const list = await this.collections.list();
      list.push(c);
      await this.collections.save(list);
      return c;
    });
  }

  async renameCollection(collectionId: string, name: string): Promise<void> {
    return runExclusive(async () => {
      const list = await this.collections.list();
      const c = list.find((x) => x.id === collectionId);
      if (!c) throw new Error(`collection not found: ${collectionId}`);
      c.name = name;
      c.updatedAt = nowIso();
      await this.collections.save(list);
    });
  }

  /** Delete a collection: remove it and drop the id from every docmeta (dual-write). */
  async deleteCollection(collectionId: string): Promise<void> {
    return runExclusive(async () => {
      const collections = await this.collections.list();
      const c = collections.find((x) => x.id === collectionId);
      if (!c) return;
      const memberIds = [...c.docIds];
      await this.collections.remove(collectionId);

      const manifest = await this.manifest.read();
      const slugsByDoc = new Map<string, string>();
      for (const d of manifest?.docs ?? []) slugsByDoc.set(d.id, d.slug);
      for (const id of memberIds) {
        const slug = slugsByDoc.get(id);
        if (!slug) continue;
        const meta = await this.meta.read(slug);
        if (meta) {
          meta.collectionIds = meta.collectionIds.filter((x) => x !== collectionId);
          await this.meta.write(slug, meta);
        }
        const md = manifest?.docs.find((d) => d.id === id);
        if (md && slug) {
          const entry = await this.fileEntry(`docs/${slug}/meta.json`);
          md.files = md.files.filter((f) => f.path !== entry.path);
          md.files.push(entry);
          md.updatedAt = nowIso();
        }
      }
      if (manifest) await this.manifest.write(manifest);
    });
  }

  /** Recovery scan (06 §1.9):
   *  - damaged: manifest lists a doc whose meta.json is missing/unparsable or folder gone
   *  - interrupted: docs/ folder with no manifest entry and no meta.json (leftover files) */
  async detectRecovery(): Promise<{
    damaged: { id: string; slug: string; title: string }[];
    interrupted: { slug: string; hasFiles: boolean }[];
  }> {
    const manifest = await this.manifest.read();
    const damaged: { id: string; slug: string; title: string }[] = [];
    if (manifest) {
      for (const d of manifest.docs) {
        const meta = await this.meta.read(d.slug);
        const folderExists = await this.fs.exists(L.docDir(this.root, d.slug));
        if (!meta || !folderExists) {
          damaged.push({ id: d.id, slug: d.slug, title: d.title });
        }
      }
    }
    const interrupted: { slug: string; hasFiles: boolean }[] = [];
    const manifestSlugs = new Set(manifest?.docs.map((d) => d.slug) ?? []);
    const slugs = await this.meta.listSlugs();
    for (const slug of slugs) {
      if (manifestSlugs.has(slug)) continue;
      const hasMeta = await this.meta.exists(slug);
      const entries = await this.fs.list(L.docDir(this.root, slug));
      if (!hasMeta && entries.length > 0) {
        interrupted.push({ slug, hasFiles: true });
      }
    }
    return { damaged, interrupted };
  }

  /** Remove a damaged doc folder (06 §1.9: "Remove (delete folder intact)"). */
  async removeDamagedFolder(slug: string): Promise<void> {
    await this.fs.delete(L.docDir(this.root, slug));
  }

  /** Remove a damaged entry from the manifest without touching folders. */
  async removeDamagedFromManifest(docId: string): Promise<void> {
    return runExclusive(async () => {
      const manifest = await this.manifest.read();
      if (!manifest) return;
      manifest.docs = manifest.docs.filter((d) => d.id !== docId);
      await this.manifest.write(manifest);
    });
  }

  private async applyDocSide(
    slug: string | undefined,
    _docId: string,
    mutate: (ids: string[]) => void
  ): Promise<void> {
    if (!slug) return;
    const meta = await this.meta.read(slug);
    if (!meta) return;
    mutate(meta.collectionIds);
    await this.meta.write(slug, meta);
  }

  private async fileEntry(libraryRelative: string): Promise<ManifestFile> {
    const abs = `${this.root}/${libraryRelative}`;
    const bytes = await this.fs.readBytes(abs);
    const hex = await sha256Hex(bytes);
    return { path: libraryRelative, size: bytes.length, sha256: hex };
  }

  private emptyManifest(): Manifest {
    return {
      schema: 1,
      app: "folio",
      libraryId: newUuid(),
      updatedAt: nowIso(),
      docs: [],
    };
  }
}
