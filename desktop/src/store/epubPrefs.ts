// Additive desktop-only reflowable presentation flags. "Publisher" is a
// presentation mode, not a schema-1 ReadingTheme value: enabling it makes the
// EPUB adapter clear its colour overrides so publisher styles (including
// inline colours) win. Stored here rather than in settings.json so the frozen
// mobile enum contract is untouched.

import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { readJsonAsync, writeJsonAtomic } from "./jsonio";

export interface EpubPrefs {
  respectPublisherColors: boolean;
}

const DEFAULT: EpubPrefs = { respectPublisherColors: false };

interface StoredEpubPrefs {
  schema?: 1;
  global?: Partial<EpubPrefs>;
  byDoc?: Record<string, Partial<EpubPrefs>>;
}

export class EpubPrefsRepo {
  constructor(
    private fs: FileStore,
    private root: string,
  ) {}

  private path(): string {
    return L.epubPrefs(this.root);
  }

  private async read(): Promise<StoredEpubPrefs | null> {
    const raw = await readJsonAsync<StoredEpubPrefs>(this.fs, this.path());
    return raw && typeof raw === "object" ? raw : null;
  }

  private async write(stored: StoredEpubPrefs): Promise<void> {
    await writeJsonAtomic(this.fs, this.path(), { schema: 1, ...stored });
  }

  async global(): Promise<EpubPrefs> {
    const stored = await this.read();
    return { ...DEFAULT, ...(stored?.global ?? {}) } as EpubPrefs;
  }

  async writeGlobal(prefs: EpubPrefs): Promise<void> {
    const stored = (await this.read()) ?? {};
    await this.write({ ...stored, global: { ...(stored.global ?? {}), ...prefs } });
  }

  async docOverride(docId: string): Promise<EpubPrefs | null> {
    const stored = await this.read();
    const value = stored?.byDoc?.[docId];
    return value ? ({ ...DEFAULT, ...value } as EpubPrefs) : null;
  }

  async writeDocOverride(docId: string, prefs: EpubPrefs): Promise<void> {
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

  async resolved(docId: string): Promise<EpubPrefs> {
    const global = await this.global();
    const override = await this.docOverride(docId);
    return override ? { ...global, ...override } : global;
  }
}
