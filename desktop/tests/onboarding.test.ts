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

describe("setup state machine", () => {
  beforeEach(() => {
    memory.clear();
    probe.mockReset();
    probe.mockResolvedValue({ hasDocs: false, hasSettings: false });
    useOnboarding.getState().refresh();
  });

  it("starts a fresh install at the look step", () => {
    expect(useOnboarding.getState().stage).toBe("look");
  });

  it("moves from look to library, never straight to done", () => {
    useOnboarding.getState().completePrefs();
    expect(memory.get(PREFS_COMPLETE_KEY)).toBe("1");
    expect(memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
    expect(useOnboarding.getState().stage).toBe("library");
  });

  it("does not let a stale step-2 flag skip the second screen", () => {
    // Regression: a tour flag left by an earlier build made completePrefs jump
    // straight to done while the screen still claimed "Step 1 of 2".
    memory.set(TOUR_COMPLETE_KEY, "1");
    useOnboarding.getState().refresh();
    expect(useOnboarding.getState().stage).toBe("look");

    useOnboarding.getState().completePrefs();
    expect(memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
    expect(useOnboarding.getState().stage).toBe("library");
  });

  it("resumes step 2 after a restart once step 1 is complete", () => {
    useOnboarding.getState().completePrefs();
    useOnboarding.getState().refresh();
    expect(useOnboarding.getState().stage).toBe("library");
  });

  it("finishes only when step 2 finishes", () => {
    useOnboarding.getState().completePrefs();
    useOnboarding.getState().completeSetup();
    expect(memory.get(TOUR_COMPLETE_KEY)).toBe("1");
    expect(useOnboarding.getState().stage).toBe("done");
  });

  it("treats both flags as done", () => {
    memory.set(PREFS_COMPLETE_KEY, "1");
    memory.set(TOUR_COMPLETE_KEY, "1");
    useOnboarding.getState().refresh();
    expect(useOnboarding.getState().stage).toBe("done");
  });

  it("replays the tour without changing setup state", () => {
    memory.set(PREFS_COMPLETE_KEY, "1");
    memory.set(TOUR_COMPLETE_KEY, "1");
    useOnboarding.getState().refresh();
    useOnboarding.getState().replayTour();
    expect(useOnboarding.getState().tourOpen).toBe(true);
    expect(useOnboarding.getState().stage).toBe("done");
    // The opt-in tour must not clear the step-2 flag, or the next launch would
    // resume setup instead of opening the library.
    expect(memory.get(TOUR_COMPLETE_KEY)).toBe("1");
  });

  it("treats a malformed saved flag as not completed", () => {
    memory.set(PREFS_COMPLETE_KEY, "yes");
    useOnboarding.getState().refresh();
    expect(useOnboarding.getState().stage).toBe("look");
  });

  it("skips both steps when the library already has documents", async () => {
    probe.mockResolvedValue({ hasDocs: true, hasSettings: false });
    await useOnboarding.getState().boot();
    expect(useOnboarding.getState().stage).toBe("done");
    expect(useOnboarding.getState().tourOpen).toBe(false);
    expect(memory.get(PREFS_COMPLETE_KEY)).toBe("1");
    expect(memory.get(TOUR_COMPLETE_KEY)).toBe("1");
  });

  it("skips step 1 but keeps step 2 when saved preferences already exist", async () => {
    probe.mockResolvedValue({ hasDocs: false, hasSettings: true });
    await useOnboarding.getState().boot();
    expect(useOnboarding.getState().stage).toBe("library");
    expect(useOnboarding.getState().tourOpen).toBe(false);
    expect(memory.get(PREFS_COMPLETE_KEY)).toBe("1");
    expect(memory.get(TOUR_COMPLETE_KEY)).toBeUndefined();
  });

  it("starts a truly fresh install at step 1", async () => {
    await useOnboarding.getState().boot();
    expect(useOnboarding.getState().stage).toBe("look");
  });

  it("closes the opt-in tour for this session without writing anything", () => {
    memory.set(PREFS_COMPLETE_KEY, "1");
    memory.set(TOUR_COMPLETE_KEY, "1");
    useOnboarding.getState().refresh();
    useOnboarding.getState().replayTour();
    useOnboarding.getState().dismissTour();
    expect(useOnboarding.getState().tourOpen).toBe(false);
    expect(useOnboarding.getState().stage).toBe("done");
    expect(memory.get(TOUR_COMPLETE_KEY)).toBe("1");
  });
});
