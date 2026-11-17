// E7 (Phase 4): synced appearance prefs — localStorage keys mirrored into
// the backed-up user/window.json and restored on boot when missing locally.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/lib/storage", () => ({
  readStorage: (key: string) => memory.get(key) ?? null,
  writeStorage: (key: string, value: string) => {
    memory.set(key, String(value));
  },
  removeStorage: (key: string) => {
    memory.delete(key);
  },
  setStorageMirror: () => {},
}));

import { MemoryFileStore } from "../src/lib/fileStore";
import {
  initSyncedPrefs,
  mirrorStorageChange,
  restoreSyncedPrefs,
  resetSyncedPrefsForTest,
} from "../src/lib/syncedPrefs";
import { setStorageMirror } from "../src/lib/storage";

const APP = "/folio-library";
let fs: MemoryFileStore;

beforeEach(() => {
  vi.useFakeTimers();
  memory.clear();
  fs = new MemoryFileStore();
  initSyncedPrefs({ fs, appDir: APP });
  setStorageMirror(mirrorStorageChange);
});

afterEach(() => {
  resetSyncedPrefsForTest();
  setStorageMirror(null);
  vi.useRealTimers();
});

async function windowJson(): Promise<Record<string, unknown>> {
  const raw = await fs.readText(`${APP}/user/window.json`);
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("mirror", () => {
  it("flushes synced writes into user/window.json, preserving unknown keys", async () => {
    await fs.writeTextAtomic(`${APP}/user/window.json`, JSON.stringify({ autoBackup: true }));
    memory.set("folio.theme-setting", "light");

    writeSynced();
    function writeSynced(): void {
      mirrorStorageChange("folio.theme-setting", "dark");
    }
    await vi.advanceTimersByTimeAsync(600);

    expect(await windowJson()).toEqual({ autoBackup: true, "folio.theme-setting": "dark" });
  });

  it("ignores unsynced keys", async () => {
    mirrorStorageChange("some.other.key", "x");
    await vi.advanceTimersByTimeAsync(600);
    expect(await fs.exists(`${APP}/user/window.json`)).toBe(false);
  });

  it("mirrors removals as key deletions", async () => {
    await fs.writeTextAtomic(
      `${APP}/user/window.json`,
      JSON.stringify({ "folio.theme-setting": "dark", autoBackup: true }),
    );
    mirrorStorageChange("folio.theme-setting", null);
    await vi.advanceTimersByTimeAsync(600);
    expect(await windowJson()).toEqual({ autoBackup: true });
  });

  it("coalesces a burst into one flush", async () => {
    mirrorStorageChange("folio.ui.zoom", "110");
    mirrorStorageChange("folio.ui.zoom", "120");
    await vi.advanceTimersByTimeAsync(600);
    expect(await windowJson()).toEqual({ "folio.ui.zoom": "120" });
  });
});

describe("restoreSyncedPrefs", () => {
  it("fills only the synced keys missing locally and re-applies them", async () => {
    document.documentElement.lang = "";
    document.documentElement.dir = "";
    await fs.writeTextAtomic(
      `${APP}/user/window.json`,
      JSON.stringify({
        "folio.ui.locale": "hi",
        "folio.library.sort": "title",
        "folio.library.view": "grid",
        autoBackup: true,
      }),
    );
    memory.set("folio.library.sort", "recent"); // local value must win

    const applied = await restoreSyncedPrefs();
    expect(applied).toEqual(["folio.library.view", "folio.ui.locale"]);
    expect(memory.get("folio.ui.locale")).toBe("hi");
    expect(memory.get("folio.library.sort")).toBe("recent");
    // locale is re-applied to <html>
    expect(document.documentElement.lang).toBe("hi");
    document.documentElement.lang = "";
    document.documentElement.dir = "";
  });

  it("returns [] without a host or a settings file", async () => {
    resetSyncedPrefsForTest();
    expect(await restoreSyncedPrefs()).toEqual([]);
    initSyncedPrefs({ fs, appDir: APP });
    expect(await restoreSyncedPrefs()).toEqual([]);
  });
});
