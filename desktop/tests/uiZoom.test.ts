// S1 (Phase 4): UI zoom clamping and application.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyUiZoom, clampUiZoom, readUiZoom, UI_ZOOM_KEY } from "../src/lib/uiZoom";

// The runner's jsdom window has no usable localStorage; back the storage
// helpers with a map (same pattern as tests/onboarding.test.ts).
const { memory } = vi.hoisted(() => ({ memory: new Map<string, string>() }));
vi.mock("../src/lib/storage", () => ({
  readStorage: (key: string) => memory.get(key) ?? null,
  writeStorage: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeStorage: (key: string) => {
    memory.delete(key);
  },
}));

beforeEach(() => {
  memory.clear();
  document.documentElement.style.zoom = "";
});

describe("clampUiZoom", () => {
  it("clamps into the 80–150 range and defaults to 100", () => {
    expect(clampUiZoom(100)).toBe(100);
    expect(clampUiZoom(79)).toBe(80);
    expect(clampUiZoom(151)).toBe(150);
    expect(clampUiZoom(80)).toBe(80);
    expect(clampUiZoom(150)).toBe(150);
    expect(clampUiZoom(Number.NaN)).toBe(100);
    // non-integer input rounds to a whole percent
    expect(clampUiZoom(125.4)).toBe(125);
  });
});

describe("applyUiZoom", () => {
  it("applies the ratio to the document root and returns the clamped value", () => {
    expect(applyUiZoom(125)).toBe(125);
    expect(document.documentElement.style.zoom).toBe("1.25");
    expect(applyUiZoom(80)).toBe(80);
    expect(document.documentElement.style.zoom).toBe("0.8");
    // 100 clears the override entirely
    expect(applyUiZoom(100)).toBe(100);
    expect(document.documentElement.style.zoom).toBe("");
    expect(applyUiZoom(999)).toBe(150);
    expect(document.documentElement.style.zoom).toBe("1.5");
  });

  it("reads back 100 when the stored key is removed", () => {
    applyUiZoom(125);
    expect(readUiZoom()).toBe(125);
    memory.delete(UI_ZOOM_KEY);
    expect(readUiZoom()).toBe(100);
  });
});
