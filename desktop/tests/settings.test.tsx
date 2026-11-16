// S1/S3 (Phase 4): settings screen additions — UI zoom persistence, keep-awake
// toggle writing user/window.json, default library sort/view, and the
// diagnostics/privacy rows.
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryFileStore } from "../src/lib/fileStore";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  prefsGlobal: vi.fn(),
  prefsWrite: vi.fn(),
  memory: new Map<string, string>(),
  fs: null as unknown,
}));

// The test runner's jsdom window has no localStorage; the storage helpers are
// backed by an in-memory map (same pattern as tests/onboarding.test.ts).
vi.mock("../src/lib/storage", () => ({
  readStorage: (key: string) => h.memory.get(key) ?? null,
  writeStorage: (key: string, value: string) => {
    h.memory.set(key, value);
  },
  removeStorage: (key: string) => {
    h.memory.delete(key);
  },
}));

vi.mock("../src/store/libraryUi", () => ({
  getLibraryFs: () => h.fs as MemoryFileStore,
  getLibraryManager: () => ({ prefs: { global: h.prefsGlobal, writeGlobal: h.prefsWrite } }),
  LIBRARY_ROOT: "/folio-library/library",
  useLibraryUi: { getState: () => ({ refresh: vi.fn() }) },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { useThemeStore } from "../src/theme/theme";
import { readUiZoom, UI_ZOOM_KEY } from "../src/lib/uiZoom";
import { PREFS_COMPLETE_KEY, TOUR_COMPLETE_KEY } from "../src/onboarding/onboardingState";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

vi.mock("../src/lib/errorLog", () => ({
  handleError: vi.fn(),
}));

function chip(label: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll<HTMLButtonElement>(".folio-chip")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`chip ${label} not found`);
  return found;
}

/** Chip inside a labelled group (rows share labels like On/Off). */
function chipIn(group: string, label: string): HTMLButtonElement {
  const found = Array.from(
    container!.querySelectorAll<HTMLButtonElement>(`div[aria-label="${group}"] .folio-chip`),
  ).find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`chip ${label} not found in group ${group}`);
  return found;
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`button ${label} not found`);
  return found;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SettingsScreen />);
  });
  await flush();
}

beforeEach(() => {
  h.fs = new MemoryFileStore();
  h.prefsGlobal.mockReset().mockResolvedValue({
    theme: "light",
    fontFamily: "serif",
    fontSize: 18,
  });
  h.prefsWrite.mockReset().mockResolvedValue(undefined);
  useThemeStore.setState({ setting: "system" });
  h.memory.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("Settings — S1 UI zoom", () => {
  it("applies and persists a zoom step; 100% clears the override", async () => {
    await render();
    act(() => chip("125%").click());
    expect(document.documentElement.style.zoom).toBe("1.25");
    expect(h.memory.get(UI_ZOOM_KEY)).toBe("125");
    expect(readUiZoom()).toBe(125);

    act(() => chip("100%").click());
    expect(document.documentElement.style.zoom).toBe("");
    expect(h.memory.get(UI_ZOOM_KEY)).toBe("100");
  });
});

describe("Settings — S1 keep screen awake", () => {
  it("writes preventSleepWhileReading into user/window.json", async () => {
    await render();
    expect(container!.textContent).toContain("Keep screen awake");
    await act(async () => {
      chipIn("Keep screen awake", "Off").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const raw = await (h.fs as MemoryFileStore).readText("/folio-library/user/window.json");
    expect(JSON.parse(raw)).toMatchObject({ preventSleepWhileReading: false });
  });
});

describe("Settings — S1 default library sort/view", () => {
  it("persists the chosen sort and view", async () => {
    await render();
    const select = container!.querySelector<HTMLSelectElement>(
      'select[aria-label="Default library sort"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(select, "title");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      chip("Grid").click();
      await Promise.resolve();
    });
    expect(h.memory.get("folio.library.sort")).toBe("title");
    expect(h.memory.get("folio.library.view")).toBe("grid");
  });
});

describe("Settings — S1 default reading prefs", () => {
  it("saves the whole pref draft, preserving unknown keys", async () => {
    h.prefsGlobal.mockResolvedValue({
      theme: "light",
      fontSize: 18,
      lineHeight: 1.6,
      // legacy dead field that must survive the write
      pdfZoom: "1",
      unknownFutureKey: "keep-me",
    });
    await render();
    await act(async () => {
      button("Edit").click();
      await Promise.resolve();
    });
    // save via the dialog footer button
    const dialog = container!.querySelector(".folio-dialog")!;
    const save = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === "Save",
    )!;
    await act(async () => {
      save.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.prefsWrite).toHaveBeenCalledTimes(1);
    const written = h.prefsWrite.mock.calls[0][0];
    expect(written.pdfZoom).toBe("1");
    expect(written.unknownFutureKey).toBe("keep-me");
  });
});

describe("Settings — S1 automatic backups", () => {
  it("writes autoBackup into user/window.json", async () => {
    await render();
    expect(container!.textContent).toContain("Automatic backups");
    await act(async () => {
      chipIn("Automatic backups", "On").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const raw = await (h.fs as MemoryFileStore).readText("/folio-library/user/window.json");
    expect(JSON.parse(raw)).toMatchObject({ autoBackup: true });
  });
});

describe("Settings — X1 reopen last book", () => {
  it("writes reopenLastBook into user/window.json", async () => {
    await render();
    expect(container!.textContent).toContain("Reopen last book");
    await act(async () => {
      chipIn("Reopen last book", "On").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const raw = await (h.fs as MemoryFileStore).readText("/folio-library/user/window.json");
    expect(JSON.parse(raw)).toMatchObject({ reopenLastBook: true });
  });
});

describe("Settings — X3 high contrast", () => {
  it("toggles the html class and persists the choice", async () => {
    document.documentElement.classList.remove("folio-high-contrast");
    await render();
    expect(container!.textContent).toContain("High contrast");
    await act(async () => {
      chipIn("High contrast", "On").click();
    });
    expect(document.documentElement.classList.contains("folio-high-contrast")).toBe(true);
    expect(h.memory.get("folio.ui.contrast")).toBe("high");
    await act(async () => {
      chipIn("High contrast", "Off").click();
    });
    expect(document.documentElement.classList.contains("folio-high-contrast")).toBe(false);
    expect(h.memory.get("folio.ui.contrast")).toBe("normal");
  });
});

describe("Settings — S1 reset app data", () => {
  const realLocation = window.location;
  const reload = vi.fn();

  beforeAll(() => {
    // jsdom's location.reload is non-configurable; replace the whole object.
    Reflect.deleteProperty(window, "location");
    (window as unknown as { location: unknown }).location = { reload };
  });

  afterAll(() => {
    (window as unknown as { location: unknown }).location = realLocation;
  });

  beforeEach(() => {
    reload.mockClear();
  });

  it("requires the acknowledgement checkbox before deleting", async () => {
    await (h.fs as MemoryFileStore).writeTextAtomic("/folio-library/library/manifest.json", "{}");
    await (h.fs as MemoryFileStore).writeTextAtomic("/folio-library/user/window.json", "{}");
    h.memory.set(PREFS_COMPLETE_KEY, "1");
    h.memory.set(TOUR_COMPLETE_KEY, "1");
    await render();

    button("Reset…").click();
    await flush();
    const dialog = container!.querySelector(".folio-dialog")!;
    const del = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === "Delete everything",
    )!;
    expect(del.disabled).toBe(true);

    const box = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      box.click();
      await Promise.resolve();
    });
    const del2 = Array.from(
      container!.querySelector(".folio-dialog")!.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent?.trim() === "Delete everything")!;
    expect(del2.disabled).toBe(false);
    await act(async () => {
      del2.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // every app-dir child deleted, setup flags cleared, reload triggered
    expect(await (h.fs as MemoryFileStore).exists("/folio-library/library/manifest.json")).toBe(
      false,
    );
    expect(await (h.fs as MemoryFileStore).exists("/folio-library/user/window.json")).toBe(false);
    expect(h.memory.has(PREFS_COMPLETE_KEY)).toBe(false);
    expect(h.memory.has(TOUR_COMPLETE_KEY)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
