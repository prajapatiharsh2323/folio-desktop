// DocMeta repo: per-doc meta.json + folder file enumeration for manifests.
import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { readJsonAsync, writeJsonAtomic } from "./jsonio";
import type { DocMeta, ManifestFile } from "../model/types";
import { sha256Hex } from "../lib/sha256";

export class DocMetaRepo {
  constructor(
    private fs: FileStore,
    private root: string
  ) {}

  async read(slug: string): Promise<DocMeta | null> {
    return readJsonAsync<DocMeta>(this.fs, L.docMeta(this.root, slug));
  }

  async write(slug: string, meta: DocMeta): Promise<void> {
    await writeJsonAtomic(this.fs, L.docMeta(this.root, slug), meta);
  }

  async exists(slug: string): Promise<boolean> {
    return this.fs.exists(L.docMeta(this.root, slug));
  }

  async listSlugs(): Promise<string[]> {
    const entries = await this.fs.list(L.docsDir(this.root));
    return entries.filter((e) => e.isDir).map((e) => e.path.split("/").pop() ?? "");
  }

  /** sha256 + size for a doc-folder file (library-relative path), for manifests. */
  async statFile(libraryRelativePath: string): Promise<ManifestFile | null> {
    const abs = `${this.root}/${libraryRelativePath}`;
    if (!(await this.fs.exists(abs))) return null;
    const bytes = await this.fs.readBytes(abs);
    const hex = await sha256Hex(bytes);
    return { path: libraryRelativePath, size: bytes.length, sha256: hex };
  }
}
