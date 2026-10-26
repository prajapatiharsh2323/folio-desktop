// Shared sync status + the single 15-minute scheduler state (09 §2).
// The scheduler lives in the shell so auto-sync keeps running on any route.
import { create } from "zustand";
import { DESKTOP_APP_DIR } from "../reader/keepAwake";
import { getLibraryFs, LIBRARY_ROOT, useLibraryUi } from "../store/libraryUi";
import { DriveClient, type SyncFailure } from "./driveClient";
import { classifySyncError, runSync, type SyncResult } from "./engine";

const AUTO_KEY = "folio.sync.auto";

function storedAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === "1";
  } catch {
    return false;
  }
}

interface SyncStatusState {
  auto: boolean;
  signedIn: boolean;
  checking: boolean;
  busy: boolean;
  status: string | null;
  failure: SyncFailure | null;
  result: SyncResult | null;
  lastSyncAt: string | null;
  setAuto: (value: boolean) => void;
  setSignedIn: (value: boolean) => void;
  setChecking: (value: boolean) => void;
  runNow: () => Promise<void>;
  reset: () => void;
}

let running = false;

export const useSyncStatus = create<SyncStatusState>((set) => ({
  auto: storedAuto(),
  signedIn: false,
  checking: true,
  busy: false,
  status: null,
  failure: null,
  result: null,
  lastSyncAt: null,

  setAuto: (value) => {
    try {
      localStorage.setItem(AUTO_KEY, value ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ auto: value });
  },

  setSignedIn: (value) => set({ signedIn: value }),
  setChecking: (value) => set({ checking: value }),

  runNow: async () => {
    if (running) return;
    running = true;
    set({ busy: true, failure: null, result: null, status: "Starting…" });
    try {
      const summary = await runSync(new DriveClient(), {
        fs: getLibraryFs(),
        root: LIBRARY_ROOT,
        appDir: DESKTOP_APP_DIR,
        onProgress: (message) => set({ status: message }),
      });
      set({ result: summary, lastSyncAt: new Date().toISOString(), status: null });
      await useLibraryUi.getState().refresh();
    } catch (e) {
      set({ failure: classifySyncError(e), status: null });
    } finally {
      running = false;
      set({ busy: false });
    }
  },

  reset: () =>
    set({
      signedIn: false,
      result: null,
      failure: null,
      lastSyncAt: null,
      status: null,
    }),
}));
