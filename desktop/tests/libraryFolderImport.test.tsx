// F7 (Phase 5): Library screen folder-import wiring — the toolbar button
// scans the granted folder and hands the files to the shared import queue.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const memory = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/lib/storage", () => ({
  readStorage: (key: string) => memory.get(key) ?? null,
  writeStorage: (key: string, value: string) => {
    memory.set(key, String(value));
  },
  removeStorage: (key: string) => {
    memory.delete(key);
  },
}));

const importPicked = vi.hoisted(() => vi.fn<(files: unknown[]) => Promise<unknown>>());
const scan = vi.hoisted(() => ({
  files: [{ name: "a.epub", size: 3, read: async () => new Uint8Array([1]) }],
  skippedCount: 0,
  truncated: false,
}));

/** One shelf row so the toolbar (count > 0) renders. */
const row = vi.hoisted(() => ({
  id: "d1",
  slug: "d1",
  title: "A Book",
  author: null,
  kind: "book" as const,
  format: "epub" as const,
  percent: 0,
  tint: 0,
  coverUrl: null,
  importedAt: "2026-01-01T00:00:00.000Z",
  activityAt: "2026-01-01T00:00:00.000Z",
  tags: [],
  lastReadAt: null,
  minutesLeft: null,
}));

vi.mock("../src/lib/fileSource", () => ({
  pickImportFiles: async () => [],
  pickImportFolder: async () => "/picked",
  pickBackupDestPath: async () => null,
  pickImageDestPath: async () => null,
  pickExportDestPath: async () => null,
  onDroppedFiles: async () => () => {},
  filesFromDataTransfer: async () => [],
}));

vi.mock("../src/lib/folderImport", () => ({
  FolderScanError: class extends Error {
    constructor(m: string) {
      super(m);
    }
  },
  scanFolderForImport: vi.fn(async () => scan),
  MAX_FOLDER_FILES: 500,
  MAX_WALK_DEPTH: 6,
}));

vi.mock("../src/store/libraryUi", async () => {
  const { MemoryFileStore } = await import("../src/lib/fileStore");
  const { DEFAULT_READING_PREFS } = await import("../src/model/defaults");

  const state = {
    rows: [row],
    loading: false,
    refreshing: false,
    error: null as string | null,
    recovery: null,
    recoveryDialogOpen: false,
    setRecoveryDialogOpen: vi.fn(),
    duplicate: null,
    resolveDuplicate: vi.fn(),
    cancelDuplicate: vi.fn(),
    importProgress: null,
    lastImportedIds: [] as string[],
    refresh: vi.fn(async () => undefined),
    refreshDocs: vi.fn(async () => undefined),
    importPicked,
    removeDamaged: vi.fn(),
    removeInterrupted: vi.fn(),
  };
  const useLibraryUi = (selector: (s: typeof state) => unknown) => selector(state);
  useLibraryUi.getState = () => state;

  const manager = {
    root: "/folio-library/library",
    load: async () => ({
      schema: 1,
      app: "folio",
      libraryId: "00000000-0000-4000-8000-000000000000",
      updatedAt: "2026-01-01T00:00:00.000Z",
      docs: [],
    }),
    collections: { list: async () => [] },
    prefs: {
      global: async () => ({ ...DEFAULT_READING_PREFS }),
      writeGlobal: async () => undefined,
    },
  };

  return {
    LIBRARY_ROOT: "/folio-library/library",
    getLibraryFs: () => new MemoryFileStore(),
    getLibraryManager: () => manager,
    subscribeLibraryChanges: () => () => {},
    notifyLibraryChanged: () => {},
    useLibraryUi,
  };
});

import { LibraryScreen } from "../src/screens/LibraryScreen";
import { scanFolderForImport } from "../src/lib/folderImport";
import { useToasts } from "../src/shell/toasts";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  importPicked.mockClear();
  importPicked.mockResolvedValue(undefined);
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function mountLibrary(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<LibraryScreen />);
  });
  return container;
}

describe("Library — F7 import folder", () => {
  it("has an Import folder button that scans and feeds the import queue", async () => {
    const el = await mountLibrary();
    const button = el.querySelector<HTMLButtonElement>('button[aria-label="Import folder…"]');
    expect(button).toBeDefined();
    await act(async () => {
      button!.click();
    });
    expect(importPicked).toHaveBeenCalledWith(scan.files);
  });

  it("surfaces a scan failure as a toast, not a crash", async () => {
    const mod = await import("../src/lib/folderImport");
    (scanFolderForImport as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new mod.FolderScanError("No importable books or articles were found in that folder."),
    );
    const el = await mountLibrary();
    const button = el.querySelector<HTMLButtonElement>('button[aria-label="Import folder…"]')!;
    await act(async () => {
      button.click();
    });
    expect(importPicked).not.toHaveBeenCalled();
    // the toast fired with the plain-language copy
    expect(useToasts.getState().toasts[0]?.tone).toBe("error");
    expect(useToasts.getState().toasts[0]?.text).toContain("No importable books");
  });
});
