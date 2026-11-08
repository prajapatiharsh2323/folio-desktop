import { beforeEach, describe, expect, it, vi } from "vitest";

// The test runner's jsdom window does not expose localStorage in this
// environment, so the state module is exercised against an in-memory store.
const { memory, probe } = vi.hoisted(() => ({
  memory: new Map<string, string>(),
  probe: vi.fn(),
}));

vi.mock("../src/lib/storage", () => ({
  readStorage: (key: string) => memory.get(key) ?? null,
  writeStorage: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeStorage: (key: string) => {
    memory.delete(key);
  },
}));

vi.mock("../src/onboarding/libraryProbe", () => ({
  probeExistingLibrary: probe,
}));

import {
  PREFS_COMPLETE_KEY,
  TOUR_COMPLETE_KEY,
  useOnboarding,
} from "../src/onboarding/onboardingState";

describe("onboarding state", () => {
  beforeEach(() => {
    memory.clear();
    probe.mockReset();
    probe.mockResolvedValue({ hasDocs: false, hasSettings: false });
    useOnboarding.getState().refresh();
  });

  it("starts a fresh install at preference setup", () => {
    expect(useOnboarding.getState().stage).toBe("prefs");
  });

  it("hands off from preference setup to the tour, not straight to done", () => {
    useOnboarding.getState().completePrefs();
    expect(memory.get(PREFS_COMPLETE_KEY)).toBe("1");
    expect(memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
    expect(useOnboarding.getState().stage).toBe("tour");
  });

  it("resumes the tour after a restart once setup is complete", () => {
    useOnboarding.getState().completePrefs();
    // Simulate closing and reopening: module state is rebuilt from storage.
    useOnboarding.getState().refresh();
    expect(useOnboarding.getState().stage).toBe("tour");
  });

  it("finishes onboarding only when the tour is completed", () => {
    useOnboarding.getState().completePrefs();
    useOnboarding.getState().completeTour();
    expect(memory.get(TOUR_COMPLETE_KEY)).toBe("1");
    expect(useOnboarding.getState().stage).toBe("done");
  });

  it("replays only the tour", () => {
    useOnboarding.getState().completePrefs();
    useOnboarding.getState().completeTour();
    useOnboarding.getState().replayTour();
    expect(memory.get(PREFS_COMPLETE_KEY)).toBe("1");
    expect(memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
    expect(useOnboarding.getState().stage).toBe("tour");
  });

  it("treats a malformed saved flag as not completed", () => {
    memory.set(PREFS_COMPLETE_KEY, "yes");
    useOnboarding.getState().refresh();
    expect(useOnboarding.getState().stage).toBe("prefs");
  });

  it("skips setup and tour when the library already has documents", async () => {
    probe.mockResolvedValue({ hasDocs: true, hasSettings: false });
    await useOnboarding.getState().boot();
    expect(useOnboarding.getState().stage).toBe("done");
    expect(useOnboarding.getState().tourOpen).toBe(false);
    expect(memory.get(PREFS_COMPLETE_KEY)).toBe("1");
    expect(memory.get(TOUR_COMPLETE_KEY)).toBe("1");
  });

  it("skips setup but keeps the tour when only saved preferences exist", async () => {
    probe.mockResolvedValue({ hasDocs: false, hasSettings: true });
    await useOnboarding.getState().boot();
    expect(useOnboarding.getState().stage).toBe("tour");
    expect(useOnboarding.getState().tourOpen).toBe(true);
    expect(memory.get(PREFS_COMPLETE_KEY)).toBe("1");
    expect(memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
  });

  it("starts a truly fresh install at setup", async () => {
    await useOnboarding.getState().boot();
    expect(useOnboarding.getState().stage).toBe("prefs");
  });

  it("closes the tour for this session without writing the flag", () => {
    useOnboarding.getState().completePrefs();
    expect(useOnboarding.getState().tourOpen).toBe(true);
    useOnboarding.getState().dismissTour();
    expect(useOnboarding.getState().stage).toBe("tour");
    expect(useOnboarding.getState().tourOpen).toBe(false);
    expect(memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
  });
});
