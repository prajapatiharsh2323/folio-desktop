// X3 (Phase 4): opt-in high-contrast mode.
import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/lib/storage", () => ({
  readStorage: (key: string) => memory.get(key) ?? null,
  writeStorage: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeStorage: (key: string) => {
    memory.delete(key);
  },
}));

import {
  applyContrastPref,
  HIGH_CONTRAST_CLASS,
  readContrastPref,
  setContrastPref,
  CONTRAST_KEY,
} from "../src/lib/highContrast";

beforeEach(() => {
  memory.clear();
  document.documentElement.classList.remove(HIGH_CONTRAST_CLASS);
});

describe("contrast pref", () => {
  it("defaults to normal and applies the class only when high", () => {
    expect(readContrastPref()).toBe("normal");
    applyContrastPref("normal");
    expect(document.documentElement.classList.contains(HIGH_CONTRAST_CLASS)).toBe(false);
    applyContrastPref("high");
    expect(document.documentElement.classList.contains(HIGH_CONTRAST_CLASS)).toBe(true);
  });

  it("persists and applies via setContrastPref", () => {
    expect(setContrastPref("high")).toBe("high");
    expect(memory.get(CONTRAST_KEY)).toBe("high");
    expect(readContrastPref()).toBe("high");
    expect(document.documentElement.classList.contains(HIGH_CONTRAST_CLASS)).toBe(true);
    setContrastPref("normal");
    expect(document.documentElement.classList.contains(HIGH_CONTRAST_CLASS)).toBe(false);
  });
});
