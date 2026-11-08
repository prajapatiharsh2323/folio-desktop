import { beforeEach, describe, expect, it, vi } from "vitest";

const { memory } = vi.hoisted(() => ({ memory: new Map<string, string>() }));

vi.mock("../src/lib/storage", () => ({
  readStorage: (key: string) => memory.get(key) ?? null,
  writeStorage: (key: string, value: string) => memory.set(key, value),
  removeStorage: (key: string) => memory.delete(key),
}));

import { initTheme } from "../src/theme/theme";

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
