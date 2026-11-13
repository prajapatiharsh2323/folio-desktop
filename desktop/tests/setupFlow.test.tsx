import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  memory: new Map<string, string>(),
  importPicked: vi.fn(),
  prefsGlobal: vi.fn(),
  prefsWriteGlobal: vi.fn(),
  pickImportFiles: vi.fn(),
  filesFromDataTransfer: vi.fn(),
}));

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
  getLibraryFs: () => ({ exists: async () => false }),
  getLibraryManager: () => ({
    prefs: {
      global: h.prefsGlobal,
      writeGlobal: h.prefsWriteGlobal,
    },
  }),
  useLibraryUi: (selector: (state: { importPicked: typeof h.importPicked }) => unknown) =>
    selector({ importPicked: h.importPicked }),
}));

vi.mock("../src/lib/fileSource", () => ({
  pickImportFiles: h.pickImportFiles,
  filesFromDataTransfer: h.filesFromDataTransfer,
  filesFromTauriDrop: async () => null,
  onDroppedFiles: async () => () => {},
  pickBackupDestPath: async () => null,
  pickBackupSourcePath: async () => null,
  pickImageDestPath: async () => null,
}));

import { OnboardingFlow } from "../src/onboarding/OnboardingFlow";
import {
  PREFS_COMPLETE_KEY,
  TOUR_COMPLETE_KEY,
  useOnboarding,
} from "../src/onboarding/onboardingState";
import { useRouteStore } from "../src/store/routeStore";
import { useThemeStore } from "../src/theme/theme";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const PREFS = {
  theme: "light",
  fontFamily: "serif",
  fontSize: 16,
  lineHeight: 1.8,
  unknownSchemaKey: "keep-me",
};

function button(label: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`button ${label} not found`);
  return found;
}

function radio(label: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll<HTMLButtonElement>("[role='radio']")).find(
    (b) => b.textContent?.includes(label),
  );
  if (!found) throw new Error(`radio ${label} not found`);
  return found;
}

async function render(stage: "look" | "library") {
  useOnboarding.setState({ stage, tourOpen: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // Mirror App: setup surfaces only exist while the machine is in look/library.
  function Host() {
    const current = useOnboarding((s) => s.stage);
    return current === "look" || current === "library" ? <OnboardingFlow /> : null;
  }
  await act(async () => {
    root!.render(<Host />);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.memory.clear();
  h.importPicked.mockReset();
  h.prefsGlobal.mockReset();
  h.prefsWriteGlobal.mockReset();
  h.pickImportFiles.mockReset();
  h.filesFromDataTransfer.mockReset();
  h.prefsGlobal.mockResolvedValue({ ...PREFS });
  h.prefsWriteGlobal.mockResolvedValue(undefined);
  h.importPicked.mockResolvedValue({
    added: 1,
    skipped: 0,
    failures: [],
    title: "Dune",
  });
  h.pickImportFiles.mockResolvedValue([{ name: "dune.epub", bytes: new Uint8Array([1]) }]);
  useThemeStore.setState({ setting: "system" });
  useRouteStore.setState({ route: "library", readerRequest: null, readerOrigin: null });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
});

describe("setup — step 1 (look)", () => {
  it("shows one reading question and two progress dots", async () => {
    await render("look");
    expect(container!.textContent).toContain("How do you like to read?");
    expect(container!.textContent).toContain("Theme");
    expect(container!.textContent).toContain("Typeface");
    expect(container!.textContent).toContain("Size");
    expect(container!.querySelector("[aria-label='Step 1 of 2']")).not.toBeNull();
  });

  it("writes only theme, font family and size, then moves to step 2", async () => {
    await render("look");
    await flush();

    act(() => radio("Dark").click());
    act(() => radio("Sans").click());
    act(() => radio("Large").click());
    await act(async () => {
      button("Continue").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(h.prefsWriteGlobal).toHaveBeenCalledTimes(1);
    const written = h.prefsWriteGlobal.mock.calls[0][0];
    expect(written).toMatchObject({
      theme: "dark",
      fontFamily: "sans",
      fontSize: 22,
      lineHeight: 1.8,
      unknownSchemaKey: "keep-me",
    });
    expect(h.memory.get(PREFS_COMPLETE_KEY)).toBe("1");
    expect(h.memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
    expect(useOnboarding.getState().stage).toBe("library");
    expect(useThemeStore.getState().setting).toBe("dark");
  });

  it("restores the saved typeface and size before the user touches anything", async () => {
    h.prefsGlobal.mockResolvedValue({
      ...PREFS,
      fontFamily: "sans",
      fontSize: 24,
    });
    await render("look");
    await flush();

    expect(radio("Sans").getAttribute("aria-checked")).toBe("true");
    expect(radio("Large").getAttribute("aria-checked")).toBe("true");
  });

  it("Skip changes no preferences but still advances to step 2", async () => {
    await render("look");
    await flush();

    act(() => radio("Dark").click());
    act(() => button("Skip").click());

    expect(h.prefsWriteGlobal).not.toHaveBeenCalled();
    expect(useThemeStore.getState().setting).toBe("system");
    expect(h.memory.get(PREFS_COMPLETE_KEY)).toBe("1");
    expect(h.memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
    expect(useOnboarding.getState().stage).toBe("library");
  });

  it("reports a failed save and stays on step 1", async () => {
    h.prefsWriteGlobal.mockRejectedValue(new Error("disk full"));
    await render("look");
    await flush();

    await act(async () => {
      button("Continue").click();
      await Promise.resolve();
    });

    expect(container!.querySelector("[role='alert']")?.textContent).toContain("Couldn't save");
    expect(useOnboarding.getState().stage).toBe("look");
    expect(h.memory.get(PREFS_COMPLETE_KEY)).toBeUndefined();
  });
});

describe("setup — step 2 (library)", () => {
  it("shows the add-a-book screen with step 2 dots", async () => {
    await render("library");
    expect(container!.textContent).toContain("Add your first book");
    expect(container!.textContent).toContain("I'll do this later");
    expect(container!.textContent).toContain("Take a short tour");
    expect(container!.querySelector("[aria-label='Step 2 of 2']")).not.toBeNull();
  });

  it("imports a picked file, confirms its title, then finishes", async () => {
    vi.useFakeTimers();
    await render("library");

    await act(async () => {
      button("Choose files").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(h.importPicked).toHaveBeenCalledWith([
      { name: "dune.epub", bytes: new Uint8Array([1]) },
    ]);
    expect(container!.querySelector("[role='status']")?.textContent).toBe("Dune");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(useOnboarding.getState().stage).toBe("done");
    expect(h.memory.get(TOUR_COMPLETE_KEY)).toBe("1");
    expect(useRouteStore.getState().route).toBe("library");
  });

  it("stays put and shows an error when the import fails", async () => {
    vi.useFakeTimers();
    h.importPicked.mockResolvedValue({
      added: 0,
      skipped: 0,
      failures: ["dune.epub: bad zip"],
      title: null,
    });
    await render("library");

    await act(async () => {
      button("Choose files").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(container!.querySelector("[role='alert']")?.textContent).toContain("Couldn't import");
    expect(useOnboarding.getState().stage).toBe("library");
    expect(h.memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
  });

  it("does not leave setup hanging when the file picker throws", async () => {
    h.pickImportFiles.mockRejectedValue(new Error("no dialog"));
    await render("library");

    await act(async () => {
      button("Choose files").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container!.querySelector("[role='alert']")?.textContent).toContain(
      "Couldn't open the file picker",
    );
    expect(useOnboarding.getState().stage).toBe("library");
  });

  it("finishes without importing via I'll do this later", async () => {
    await render("library");
    act(() => button("I'll do this later").click());

    expect(h.importPicked).not.toHaveBeenCalled();
    expect(useOnboarding.getState().stage).toBe("done");
    expect(h.memory.get(TOUR_COMPLETE_KEY)).toBe("1");
  });

  it("offers the tour only when asked, after setup is complete", async () => {
    await render("library");
    act(() => button("Take a short tour").click());

    expect(useOnboarding.getState().stage).toBe("done");
    expect(useOnboarding.getState().tourOpen).toBe(true);
    expect(h.memory.get(TOUR_COMPLETE_KEY)).toBe("1");
  });
});

describe("setup layout contract", () => {
  // Normalize CRLF so the @media block slicing also works on Windows checkouts.
  const css = readFileSync(resolve(process.cwd(), "src/styles/components.css"), "utf8").replace(
    /\r\n/g,
    "\n",
  );

  it("hides the decorative preview on short windows (720×560 minimum)", () => {
    const short = css.slice(css.indexOf("@media (max-height: 639px)"));
    const block = short.slice(0, short.indexOf("}\n}") + 1);
    expect(block).toContain(".folio-setup__preview");
    expect(block).toMatch(/\.folio-setup__preview\s*\{\s*display:\s*none;/);
  });

  it("cross-fades each step for 200ms with an 8px lift", () => {
    expect(css).toContain("animation: folio-setup-step-in 200ms");
    const keyframes = css.slice(css.indexOf("@keyframes folio-setup-step-in"));
    expect(keyframes).toMatch(/opacity:\s*0/);
    expect(keyframes).toMatch(/translateY\(8px\)/);
  });

  it("has no leftover onboarding styles", () => {
    expect(css).not.toContain(".folio-onboarding");
  });
});
