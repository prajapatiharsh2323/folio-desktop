// X3 (Phase 4 Step 4.2): axe sweep over all four screens in both themes.
//
// The screens are mounted with a light libraryUi mock (empty library /
// collections / notes + an empty on-disk store, which is exactly the state a
// first-run user sees) and axe-core runs in jsdom. Color-contrast rules need
// real stylesheets, which jsdom doesn't load, so those land as "incomplete"
// rather than violations — the assertion filters to serious/critical impacts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import axe from "axe-core";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no localStorage; the app reads several prefs at boot.
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

vi.mock("../src/store/libraryUi", async () => {
  const { DEFAULT_READING_PREFS } = await import("../src/model/defaults");
  const { MemoryFileStore } = await import("../src/lib/fileStore");

  const state = {
    rows: [],
    loading: false,
    error: null as string | null,
    recovery: null,
    recoveryDialogOpen: false,
    setRecoveryDialogOpen: vi.fn(),
    duplicate: null,
    resolveDuplicate: vi.fn(),
    cancelDuplicate: vi.fn(),
    importProgress: null,
    cancelImport: vi.fn(),
    refreshing: false,
    lastImportedIds: [] as string[],
    refresh: vi.fn(),
    refreshDocs: vi.fn(),
    importPicked: vi.fn(),
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
    annotations: {
      load: async () => undefined,
      list: async () => [],
      update: async () => undefined,
      remove: async () => undefined,
    },
    prefs: {
      global: async () => ({ ...DEFAULT_READING_PREFS }),
      writeGlobal: async () => undefined,
    },
  };

  return {
    LIBRARY_ROOT: "/folio-library/library",
    getLibraryFs: () => new MemoryFileStore(),
    getLibraryManager: () => manager,
    useLibraryUi,
    // E7: screens subscribe to manifest changes; nothing fires in tests.
    subscribeLibraryChanges: () => () => {},
    notifyLibraryChanged: () => {},
  };
});

import { LibraryScreen } from "../src/screens/LibraryScreen";
import { CollectionsScreen } from "../src/screens/CollectionsScreen";
import { NotesScreen } from "../src/screens/NotesScreen";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { useThemeStore } from "../src/theme/theme";
import { useRouteStore } from "../src/store/routeStore";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  useThemeStore.setState({ setting: "system" });
  useRouteStore.getState().setRoute("library");
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function mount(ui: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(ui);
  });
  return container;
}

function seriousViolations(results: axe.AxeResults): axe.Result[] {
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

const SCREENS: [string, React.ReactElement][] = [
  ["LibraryScreen", <LibraryScreen />],
  ["CollectionsScreen", <CollectionsScreen />],
  ["NotesScreen", <NotesScreen />],
  ["SettingsScreen", <SettingsScreen />],
];

describe("axe sweep (X3)", () => {
  for (const setting of ["light", "dark"] as const) {
    describe(`${setting} theme`, () => {
      beforeEach(() => {
        useThemeStore.setState({ setting });
      });

      for (const [name, ui] of SCREENS) {
        it(`${name} has no serious or critical violations`, async () => {
          const el = await mount(ui);
          // color-contrast needs real stylesheets; jsdom can't evaluate it
          // (it would only ever report "incomplete"), so it's off here.
          const results = await axe.run(el, {
            resultTypes: ["violations"],
            rules: { "color-contrast": { enabled: false } },
          });
          expect(seriousViolations(results)).toEqual([]);
        });
      }
    });
  }
});
