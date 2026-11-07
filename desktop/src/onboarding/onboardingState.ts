// First-run onboarding state. The two completions are deliberately separate:
// finishing preference setup must not also finish the tour, so closing the app
// during the tour resumes the tour rather than restarting setup.
import { create } from "zustand";
import { readStorage, removeStorage, writeStorage } from "../lib/storage";

export type OnboardingStage = "prefs" | "tour" | "done";

export const PREFS_COMPLETE_KEY = "folio.onboarding.prefs-complete";
export const TOUR_COMPLETE_KEY = "folio.onboarding.tour-complete";

function readFlag(key: string): boolean {
  return readStorage(key) === "1";
}

export function deriveOnboardingStage(): OnboardingStage {
  if (!readFlag(PREFS_COMPLETE_KEY)) return "prefs";
  if (!readFlag(TOUR_COMPLETE_KEY)) return "tour";
  return "done";
}

interface OnboardingState {
  stage: OnboardingStage;
  /** Re-read storage; used by tests and after an external reset. */
  refresh: () => void;
  completePrefs: () => void;
  completeTour: () => void;
  replayTour: () => void;
}

export const useOnboarding = create<OnboardingState>((set) => ({
  stage: deriveOnboardingStage(),
  refresh: () => set({ stage: deriveOnboardingStage() }),
  completePrefs: () => {
    writeStorage(PREFS_COMPLETE_KEY, "1");
    set({ stage: readFlag(TOUR_COMPLETE_KEY) ? "done" : "tour" });
  },
  completeTour: () => {
    writeStorage(TOUR_COMPLETE_KEY, "1");
    set({ stage: "done" });
  },
  replayTour: () => {
    removeStorage(TOUR_COMPLETE_KEY);
    set({ stage: "tour" });
  },
}));
