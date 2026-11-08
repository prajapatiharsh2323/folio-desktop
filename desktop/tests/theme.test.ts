import { beforeEach, describe, expect, it, vi } from "vitest";

const { memory } = vi.hoisted(() => ({ memory: new Map<string, string>() }));

vi.mock("../src/lib/storage", () => ({
  readStorage: (key: string) => memory.get(key) ?? null,
  writeStorage: (key: string, value: string) => memory.set(key, value),
  removeStorage: (key: string) => memory.delete(key),
}));

import { initTheme, previewTheme, useThemeStore } from "../src/theme/theme";

describe("theme bootstrap", () => {
  beforeEach(() => {
    memory.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies a stored dark setting synchronously", () => {
    memory.set("folio.theme-setting", "dark");
    const cleanup = initTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    cleanup();
  });

  it("applies a stored light setting synchronously", () => {
    memory.set("folio.theme-setting", "light");
    const cleanup = initTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    cleanup();
  });

  it("falls back to the light side for an unknown setting", () => {
    memory.set("folio.theme-setting", "sepia");
    const cleanup = initTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    cleanup();
  });
});

describe("theme preview", () => {
  beforeEach(() => {
    memory.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies without persisting the previewed setting", () => {
    memory.set("folio.theme-setting", "light");
    const cleanup = initTheme();
    const before = memory.get("folio.theme-setting");

    previewTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(memory.get("folio.theme-setting")).toBe(before);
    expect(useThemeStore.getState().setting).toBe("light");

    cleanup();
  });

  it("restores the saved setting when the preview ends", () => {
    memory.set("folio.theme-setting", "dark");
    const cleanup = initTheme();

    previewTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    previewTheme(null);
    expect(document.documentElement.dataset.theme).toBe("dark");
    cleanup();
  });
});
