// F2 (Phase 5): Insights — the screen render and the reader-store log credit.
// jsdom has no usable localStorage: `../src/lib/storage` is mocked with a
// hoisted Map (project rule). The library manager here is the REAL
// LibraryManager over a MemoryFileStore, so repo IO is exercised end-to-end.
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

vi.mock("../src/store/libraryUi", async () => {
  const { MemoryFileStore } = await import("../src/lib/fileStore");
  const { LibraryManager } = await import("../src/store/libraryManager");
  let store = new MemoryFileStore();
  let manager = new LibraryManager(store, "/lib");
  return {
    LIBRARY_ROOT: "/lib",
    getLibraryFs: () => store,
    getLibraryManager: () => manager,
    subscribeLibraryChanges: () => () => {},
    notifyLibraryChanged: () => {},
    // Each test starts from an empty library file set.
    __resetLibrary: () => {
      store = new MemoryFileStore();
      manager = new LibraryManager(store, "/lib");
    },
  };
});

import { InsightsScreen } from "../src/screens/InsightsScreen";
import { useReaderStore } from "../src/store/readerStore";
import { getLibraryManager } from "../src/store/libraryUi";
import { dateKeyOf } from "../src/lib/readingLog";
import type { ReaderDoc } from "../src/store/readerStore";
import type { PaceState } from "../src/reader/pace";

const uiMock = async () =>
  (await import("../src/store/libraryUi")) as unknown as {
    __resetLibrary: () => void;
  };

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(async () => {
  await (await uiMock()).__resetLibrary();
  memory.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function mountInsights(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<InsightsScreen />);
  });
  return container;
}

function fakeDoc(pace: PaceState | null): ReaderDoc {
  return {
    docId: "d1",
    slug: "d1",
    title: "Alpha",
    author: null,
    meta: {} as ReaderDoc["meta"],
    epubBytes: new Uint8Array(0),
    readingBytes: new Uint8Array(0),
    format: "epub",
    prefs: {} as ReaderDoc["prefs"],
    progress: { docId: "d1", location: "a", percent: 10, updatedAt: "", pace },
    coverUrl: null,
  } as unknown as ReaderDoc;
}

describe("Insights screen (F2)", () => {
  it("shows the empty state before any reading time exists", async () => {
    const el = await mountInsights();
    expect(el.textContent).toContain("No reading time yet");
  });

  it("renders today/7/30-day totals, streak, goal and top books from seeded data", async () => {
    const lm = getLibraryManager();
    await act(async () => {
      await lm.manifest.write({
        schema: 1,
        app: "folio",
        libraryId: "00000000-0000-4000-8000-000000000000",
        updatedAt: "2026-11-17T00:00:00.000Z",
        docs: [
          {
            id: "d1",
            slug: "d1",
            title: "Alpha",
            addedAt: "2026-11-01T00:00:00.000Z",
          },
        ],
      } as never);
      await lm.progress.put({
        docId: "d1",
        location: "a",
        percent: 35,
        updatedAt: "2026-11-17T00:00:00.000Z",
        pace: { sessionsMs: 83 * 60_000, percentRead: 35 },
      });
      await lm.readingLog.addMs(dateKeyOf(new Date()), "d1", 25 * 60_000);
      await lm.readingLog.addMs("2026-11-16", "d1", 20 * 60_000);
      await lm.readingLog.addMs("2026-11-15", "d1", 20 * 60_000);
    });
    memory.set("folio.insights.goal", "30");

    const el = await mountInsights();
    const text = el.textContent ?? "";
    expect(text).toContain("Today");
    expect(text).toContain("25 min"); // today
    expect(text).toContain("1 hr 5 min"); // last 7 days = 25+20+20
    expect(text).toContain("Last 30 days");
    expect(text).toContain("3 days"); // today + the two previous days
    expect(text).toContain("Alpha");
    expect(text).toContain("1 hr 23 min"); // all-time book time
    expect(text).toContain("83% of your 30 min goal");
  });

  it("editing the goal persists it through the storage layer", async () => {
    const lm = getLibraryManager();
    await act(async () => {
      await lm.readingLog.addMs(dateKeyOf(new Date()), "d1", 5 * 60_000);
    });
    const el = await mountInsights();
    const input = el.querySelector<HTMLInputElement>("#folio-insights-goal")!;
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setValue.call(input, "45");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(memory.get("folio.insights.goal")).toBe("45");
  });
});

describe("readerStore → reading-log credit (F2)", () => {
  it("persistProgress credits the day log with the newly accrued pace time", async () => {
    const lm = getLibraryManager();
    useReaderStore.setState({ doc: fakeDoc({ sessionsMs: 60_000, percentRead: 10 }) });
    await act(async () => {
      await useReaderStore.getState().persistProgress({
        location: "b",
        percent: 12,
        pace: { sessionsMs: 150_000, percentRead: 12 },
      });
    });
    const day = (await lm.readingLog.all()).days[dateKeyOf(new Date())];
    expect(day?.perDoc?.d1).toBe(90_000);
  });

  it("does not double-credit when the snapshot carries no pace change", async () => {
    const lm = getLibraryManager();
    useReaderStore.setState({ doc: fakeDoc({ sessionsMs: 60_000, percentRead: 10 }) });
    await act(async () => {
      await useReaderStore.getState().persistProgress({
        location: "c",
        percent: 13,
        pace: null,
      });
    });
    expect((await lm.readingLog.all()).days).toEqual({});
  });
});
