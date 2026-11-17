// E7 (Phase 4): cached library manager + change events.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLibraryManager,
  notifyLibraryChanged,
  subscribeLibraryChanges,
  useLibraryUi,
} from "../src/store/libraryUi";
import { resetSyncedPrefsForTest } from "../src/lib/syncedPrefs";
import { setStorageMirror } from "../src/lib/storage";

// Keep a mirror registered by another suite (same module instance) from
// writing anywhere while these tests run.
beforeEach(() => {
  setStorageMirror(null);
  resetSyncedPrefsForTest();
});

describe("getLibraryManager cache", () => {
  it("returns the same instance across calls", () => {
    const a = getLibraryManager();
    const b = getLibraryManager();
    expect(a).toBe(b);
    expect(a.root).toBe("/folio-library/library");
  });
});

describe("library change events", () => {
  it("notifies subscribers and stops after unsubscribe", () => {
    const seen: number[] = [];
    const unsub = subscribeLibraryChanges(() => seen.push(1));
    notifyLibraryChanged();
    expect(seen).toEqual([1]);
    unsub();
    notifyLibraryChanged();
    expect(seen).toEqual([1]);
  });

  it("a throwing listener never breaks the notification", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let after = 0;
    const boom = subscribeLibraryChanges(() => {
      throw new Error("listener boom");
    });
    const ok = subscribeLibraryChanges(() => {
      after += 1;
    });
    expect(() => notifyLibraryChanged()).not.toThrow();
    expect(after).toBe(1);
    boom();
    ok();
    errorSpy.mockRestore();
  });

  it("the change event fires after a refresh", async () => {
    let events = 0;
    const unsub = subscribeLibraryChanges(() => {
      events += 1;
    });
    await useLibraryUi.getState().refresh();
    expect(events).toBeGreaterThanOrEqual(1);
    unsub();
  });
});
