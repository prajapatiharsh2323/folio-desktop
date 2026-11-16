// X1 (Phase 4): reopen-last-book on launch.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import type { Progress } from "../src/model/types";

const openSpy = vi.hoisted(() => vi.fn());

vi.mock("../src/store/routeStore", () => ({
  useRouteStore: {
    getState: () => ({ openReader: openSpy }),
  },
}));

import {
  pickLastReadDoc,
  readReopenLastSetting,
  reopenLastBookIfEnabled,
  writeReopenLastSetting,
} from "../src/shell/reopenLast";

const APP = "/folio-library";

function progress(docId: string, updatedAt: string, percent = 42): Progress {
  return { docId, location: "ch2.xhtml", percent, updatedAt, pace: null };
}

let fs: MemoryFileStore;

beforeEach(() => {
  fs = new MemoryFileStore();
  openSpy.mockClear();
});

describe("pickLastReadDoc", () => {
  it("returns the record with the newest updatedAt", () => {
    expect(pickLastReadDoc({})).toBeNull();
    expect(pickLastReadDoc({ d: progress("d", "2026-01-01T00:00:00.000Z") })).toBe("d");
    expect(
      pickLastReadDoc({
        a: progress("a", "2026-01-01T00:00:00.000Z"),
        b: progress("b", "2026-03-05T12:00:00.000Z"),
        c: progress("c", "2026-02-01T00:00:00.000Z"),
      }),
    ).toBe("b");
  });
});

describe("reopen-last setting", () => {
  it("defaults to off and round-trips through user/window.json", async () => {
    expect(await readReopenLastSetting(fs, APP)).toBe(false);
    await writeReopenLastSetting(fs, APP, true);
    expect(await readReopenLastSetting(fs, APP)).toBe(true);
    // unknown keys survive
    await fs.writeTextAtomic(`${APP}/user/window.json`, JSON.stringify({ autoBackup: true }));
    await writeReopenLastSetting(fs, APP, false);
    expect(JSON.parse(await fs.readText(`${APP}/user/window.json`))).toMatchObject({
      autoBackup: true,
      reopenLastBook: false,
    });
  });
});

describe("reopenLastBookIfEnabled", () => {
  it("does nothing when disabled", async () => {
    await fs.writeTextAtomic(`${APP}/library/manifest.json`, "{}");
    await fs.writeTextAtomic(
      `${APP}/library/user/progress.json`,
      JSON.stringify({ d1: progress("d1", "2026-01-01T00:00:00.000Z") }),
    );
    expect(await reopenLastBookIfEnabled(fs, APP, `${APP}/library`)).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("does nothing when nothing was ever read", async () => {
    await writeReopenLastSetting(fs, APP, true);
    await fs.writeTextAtomic(`${APP}/library/manifest.json`, "{}");
    expect(await reopenLastBookIfEnabled(fs, APP, `${APP}/library`)).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the last-read doc is missing from the manifest", async () => {
    await writeReopenLastSetting(fs, APP, true);
    await fs.writeTextAtomic(`${APP}/library/manifest.json`, "{}");
    await fs.writeTextAtomic(
      `${APP}/library/user/progress.json`,
      JSON.stringify({ gone: progress("gone", "2026-01-01T00:00:00.000Z") }),
    );
    expect(await reopenLastBookIfEnabled(fs, APP, `${APP}/library`)).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("opens the last-read book at its saved position via openReader", async () => {
    await writeReopenLastSetting(fs, APP, true);
    await fs.writeTextAtomic(
      `${APP}/library/manifest.json`,
      JSON.stringify({ docs: [{ id: "d1" }, { id: "d2" }] }),
    );
    await fs.writeTextAtomic(
      `${APP}/library/user/progress.json`,
      JSON.stringify({
        d1: progress("d1", "2026-01-01T00:00:00.000Z", 10),
        d2: progress("d2", "2026-02-02T00:00:00.000Z", 55),
      }),
    );
    expect(await reopenLastBookIfEnabled(fs, APP, `${APP}/library`)).toBe(true);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0]).toEqual({
      docId: "d2",
      location: "ch2.xhtml",
      percent: 55,
    });
  });
});
