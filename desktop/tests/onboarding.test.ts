import { beforeEach, describe, expect, it, vi } from "vitest";

// The test runner's jsdom window does not expose localStorage in this
// environment, so the state module is exercised against an in-memory store.
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

import {
  PREFS_COMPLETE_KEY,
  TOUR_COMPLETE_KEY,
  useOnboarding,
} from "../src/onboarding/onboardingState";

describe("onboarding state", () => {
  beforeEach(() => {
    memory.clear();
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
});
