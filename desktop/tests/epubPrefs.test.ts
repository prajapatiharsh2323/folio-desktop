// Additive EPUB presentation flags: the "Publisher" mode must persist per
// document without ever touching the frozen schema-1 ReadingTheme enum.
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import { EpubPrefsRepo } from "../src/store/epubPrefs";
import { libraryLayout as L } from "../src/lib/libraryPaths";
import { serializeJson } from "../src/store/jsonio";

describe("EpubPrefsRepo", () => {
  let fs: MemoryFileStore;
  let repo: EpubPrefsRepo;

  beforeEach(() => {
    fs = new MemoryFileStore();
    repo = new EpubPrefsRepo(fs, "/lib");
  });

  it("defaults to themed presentation", async () => {
    expect(await repo.global()).toEqual({ respectPublisherColors: false });
  });

  it("resolves and resets per-document overrides independently", async () => {
    await repo.writeGlobal({ respectPublisherColors: true });
    await repo.writeDocOverride("d1", { respectPublisherColors: false });

    expect((await repo.resolved("d1")).respectPublisherColors).toBe(false);
    expect((await repo.resolved("d2")).respectPublisherColors).toBe(true);
    expect((await repo.global()).respectPublisherColors).toBe(true);

    await repo.removeDocOverride("d1");
    expect((await repo.resolved("d1")).respectPublisherColors).toBe(true);
  });

  it("tolerates older/partial records and preserves unknown keys", async () => {
    await fs.writeTextAtomic(
      L.epubPrefs("/lib"),
      serializeJson({ schema: 1, global: { futureFlag: 7 }, byDoc: {} }),
    );
    expect((await repo.global()).respectPublisherColors).toBe(false);
    await repo.writeGlobal({ respectPublisherColors: true });
    const raw = JSON.parse(await fs.readText(L.epubPrefs("/lib")));
    expect(raw.global.futureFlag).toBe(7);
  });

  it("does not write into schema-1 settings files", async () => {
    await repo.writeDocOverride("d1", { respectPublisherColors: true });
    expect(await fs.exists(L.settings("/lib"))).toBe(false);
    expect(await fs.exists(L.docSettings("/lib"))).toBe(false);
  });
});
