// Additive, desktop-only PDF preferences. This file is deliberately outside
// the frozen schema-1 data model: settings.json / doc-settings.json and the
// mobile contract are never modified. Unknown keys survive every rewrite, and
// a first run seeds global PDF values from the user's existing legacy prefs.

import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { readJsonAsync, writeJsonAtomic } from "./jsonio";
import type { ReadingPrefs } from "../model/types";
import { pdfPrefsFromLegacy, resolvePdfPrefs, type PdfReaderPrefs } from "../model/formatPrefs";

interface StoredPdfPrefs {
  schema?: 1;
  global?: Partial<PdfReaderPrefs>;
  byDoc?: Record<string, Partial<PdfReaderPrefs>>;
}

export class PdfPrefsRepo {
  constructor(
    private fs: FileStore,
    private root: string,
    private legacy: { global(): Promise<ReadingPrefs> },
  ) {}

  private path(): string {
    return L.pdfPrefs(this.root);
  }

  private async read(): Promise<StoredPdfPrefs | null> {
    const raw = await readJsonAsync<StoredPdfPrefs>(this.fs, this.path());
    return raw && typeof raw === "object" ? raw : null;
  }

  private async write(stored: StoredPdfPrefs): Promise<void> {
    await writeJsonAtomic(this.fs, this.path(), { schema: 1, ...stored });
  }

  /** Global PDF defaults, migrated once from legacy ReadingPrefs when the
   *  additive file does not exist yet. */
  async global(): Promise<PdfReaderPrefs> {
    const stored = await this.read();
    if (!stored || !stored.global) {
      const migrated = pdfPrefsFromLegacy(await this.legacy.global());
      await this.write({ ...(stored ?? {}), global: migrated });
      return migrated;
    }
    return resolvePdfPrefs(stored.global);
  }

  async writeGlobal(prefs: PdfReaderPrefs): Promise<void> {
    const stored = (await this.read()) ?? {};
    await this.write({ ...stored, global: { ...(stored.global ?? {}), ...prefs } });
  }

  async docOverride(docId: string): Promise<PdfReaderPrefs | null> {
    const stored = await this.read();
    const value = stored?.byDoc?.[docId];
    return value ? resolvePdfPrefs(value) : null;
  }

  async writeDocOverride(docId: string, prefs: PdfReaderPrefs): Promise<void> {
    const stored = (await this.read()) ?? {};
    const byDoc = { ...(stored.byDoc ?? {}) };
    byDoc[docId] = { ...(byDoc[docId] ?? {}), ...prefs };
    await this.write({ ...stored, byDoc });
  }

  async removeDocOverride(docId: string): Promise<void> {
    const stored = await this.read();
    if (!stored?.byDoc?.[docId]) return;
    const byDoc = { ...stored.byDoc };
    delete byDoc[docId];
    await this.write({ ...stored, byDoc });
  }

  /** Global defaults merged with this document's override. */
  async resolved(docId: string): Promise<PdfReaderPrefs> {
    const global = await this.global();
    const override = await this.docOverride(docId);
    return override ? resolvePdfPrefs({ ...global, ...override }) : global;
  }
}
