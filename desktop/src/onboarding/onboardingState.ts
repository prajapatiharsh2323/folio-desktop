// First-run onboarding state. The two completions are deliberately separate:
// finishing preference setup must not also finish the tour, so closing the app
// during the tour resumes the tour rather than restarting setup.
import { create } from "zustand";
import { readStorage, removeStorage, writeStorage } from "../lib/storage";
import { probeExistingLibrary } from "./libraryProbe";

export type OnboardingStage = "booting" | "prefs" | "tour" | "done";

export const PREFS_COMPLETE_KEY = "folio.onboarding.prefs-complete";
export const TOUR_COMPLETE_KEY = "folio.onboarding.tour-complete";

/** The stage implied by the persisted flags alone (no library probe). */
export function deriveOnboardingStage(): OnboardingStage {
  if (!readFlag(PREFS_COMPLETE_KEY)) return "prefs";
  if (!readFlag(TOUR_COMPLETE_KEY)) return "tour";
  return "done";
}

function readFlag(key: string): boolean {
  return readStorage(key) === "1";
}

function stageFromFlags(): { stage: OnboardingStage; tourOpen: boolean } {
  const stage = deriveOnboardingStage();
  return { stage, tourOpen: stage === "tour" };
}

async function withCap<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, cap]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface OnboardingState {
  stage: OnboardingStage;
  /** Whether the tour overlay is visible; `stage === "tour"` only marks it pending. */
  tourOpen: boolean;
  /** Re-read flags; used by tests and after an external reset. */
  refresh: () => void;
  /** Resolve the booting stage, probing the library when flags are missing. */
  boot: () => Promise<void>;
  completePrefs: () => void;
  completeTour: () => void;
  /** Close the tour for this session without writing the permanent flag. */
  dismissTour: () => void;
  replayTour: () => void;
}

let bootPromise: Promise<void> | null = null;

export const useOnboarding = create<OnboardingState>((set) => ({
  stage: "booting",
  tourOpen: false,
  refresh: () => {
    bootPromise = null;
    set(stageFromFlags());
  },
  boot: () => {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      let next = stageFromFlags();
      if (next.stage === "prefs") {
        const probe = await withCap(probeExistingLibrary(), 1000);
        if (probe?.hasDocs) {
          // Returning user with a library but no WebView storage: skip both
          // setup and tour, matching the library that is already on disk.
          writeStorage(PREFS_COMPLETE_KEY, "1");
          writeStorage(TOUR_COMPLETE_KEY, "1");
          next = { stage: "done", tourOpen: false };
        } else if (probe?.hasSettings) {
          // Preferences were saved before an import: keep that decision but
          // still offer the tour.
          writeStorage(PREFS_COMPLETE_KEY, "1");
          next = readFlag(TOUR_COMPLETE_KEY)
            ? { stage: "done", tourOpen: false }
            : { stage: "tour", tourOpen: true };
        }
      }
      set(next);
    })().catch(() => {
      // A failed probe must never leave the splash up forever.
      set(stageFromFlags());
    });
    return bootPromise;
  },
  completePrefs: () => {
    writeStorage(PREFS_COMPLETE_KEY, "1");
    const done = readFlag(TOUR_COMPLETE_KEY);
    set({ stage: done ? "done" : "tour", tourOpen: !done });
  },
  completeTour: () => {
    writeStorage(TOUR_COMPLETE_KEY, "1");
    set({ stage: "done", tourOpen: false });
  },
  dismissTour: () => set({ tourOpen: false }),
  replayTour: () => {
    removeStorage(TOUR_COMPLETE_KEY);
    set({ stage: "tour", tourOpen: true });
  },
}));
