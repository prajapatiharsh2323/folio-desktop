// Additive desktop PDF preferences: first-run migration from legacy ReadingPrefs,
// global/per-document resolution, independent reset, and unknown-key safety.
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import { PrefsRepo } from "../src/store/repos";
import { PdfPrefsRepo } from "../src/store/pdfPrefs";
import { libraryLayout as L } from "../src/lib/libraryPaths";
import { DEFAULT_READING_PREFS } from "../src/model/defaults";
import { DEFAULT_PDF_READER_PREFS } from "../src/model/formatPrefs";
import { serializeJson } from "../src/store/jsonio";

describe("PdfPrefsRepo", () => {
  let fs: MemoryFileStore;
  let legacy: PrefsRepo;
  let repo: PdfPrefsRepo;

  beforeEach(() => {
    fs = new MemoryFileStore();
    legacy = new PrefsRepo(fs, "/lib");
    repo = new PdfPrefsRepo(fs, "/lib", legacy);
  });

  it("migrates theme, brightness, flow and spread once on first access", async () => {
    await legacy.writeGlobal({
      ...DEFAULT_READING_PREFS,
      theme: "dark",
      brightness: 70,
      flow: "scrolled",
      spread: "both",
    });
    const first = await repo.global();
    expect(first).toMatchObject({
      theme: "dark",
      brightness: 70,
      flow: "scrolled",
      spread: "both",
      zoom: DEFAULT_PDF_READER_PREFS.zoom,
      presentation: "original",
    });
    // The schema-1 files are never touched by the migration.
    const settings = JSON.parse(await fs.readText(L.settings("/lib")));
    expect(settings.pdfZoom).toBe("");
    expect(settings.maxWidth).toBe(0);
  });

  it("resolves per-document overrides without changing global defaults", async () => {
    await legacy.writeGlobal(DEFAULT_READING_PREFS);
    const global = await repo.global();
    await repo.writeDocOverride("d1", { ...global, rotation: 90, presentation: "night" });

    const resolved = await repo.resolved("d1");
    expect(resolved.rotation).toBe(90);
    expect(resolved.presentation).toBe("night");
    expect((await repo.resolved("d2")).rotation).toBe(0);
    expect((await repo.global()).rotation).toBe(0);

    await repo.removeDocOverride("d1");
    expect((await repo.resolved("d1")).rotation).toBe(0);
  });

  it("tolerates an older partial stored record", async () => {
    await fs.writeTextAtomic(
      L.pdfPrefs("/lib"),
      serializeJson({ schema: 1, global: { theme: "warm" } }),
    );
    expect(await repo.global()).toMatchObject({
      theme: "warm",
      presentation: "original",
      direction: "ltr",
      coverFirst: true,
    });
  });

  it("preserves unknown keys written by a future desktop version", async () => {
    await fs.writeTextAtomic(
      L.pdfPrefs("/lib"),
      serializeJson({
        schema: 1,
        global: { theme: "light", futurePdfSetting: "keep-me" },
        byDoc: {},
        futureContainer: 42,
      }),
    );
    await repo.writeGlobal({ ...DEFAULT_PDF_READER_PREFS, theme: "true-black" });
    const raw = JSON.parse(await fs.readText(L.pdfPrefs("/lib")));
    expect(raw.global.futurePdfSetting).toBe("keep-me");
    expect(raw.futureContainer).toBe(42);
  });
});
