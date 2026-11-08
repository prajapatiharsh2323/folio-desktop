// First-run setup is one linear machine: look → library → done.
//
// `look` is step 1 (reading appearance), `library` is step 2 (add a book), and
// `done` is the normal app. The step-2 flag is only written by the finish
// action, and step 1 always clears it, so a flag left by an earlier build or a
// previous run can never skip step 2.
import { create } from "zustand";
import { readStorage, removeStorage, writeStorage } from "../lib/storage";
import { probeExistingLibrary } from "./libraryProbe";

export type OnboardingStage = "booting" | "look" | "library" | "done";

/** Step 1 finished: preference setup was answered (or skipped). */
export const PREFS_COMPLETE_KEY = "folio.onboarding.prefs-complete";
/** Step 2 finished: setup is complete. The tour is opt-in and has no flag. */
export const TOUR_COMPLETE_KEY = "folio.onboarding.tour-complete";

/** The stage implied by the persisted flags alone (no library probe). */
export function deriveOnboardingStage(): OnboardingStage {
  if (!readFlag(PREFS_COMPLETE_KEY)) return "look";
  if (!readFlag(TOUR_COMPLETE_KEY)) return "library";
  return "done";
}

function readFlag(key: string): boolean {
  return readStorage(key) === "1";
}

function stageFromFlags(): { stage: OnboardingStage; tourOpen: boolean } {
  return { stage: deriveOnboardingStage(), tourOpen: false };
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
  /** The opt-in tour overlay (Settings → Replay, or step 2's link). */
  tourOpen: boolean;
  /** Re-read flags; used by tests and after an external reset. */
  refresh: () => void;
  /** Resolve the booting stage, probing the library when flags are missing. */
  boot: () => Promise<void>;
  /** Finish step 1 (Continue or Skip) and always move to step 2. */
  completePrefs: () => void;
  /** Finish step 2 and route to the Library. */
  completeSetup: () => void;
  /** Kept for the opt-in tour surfaces; finishing it also completes setup. */
  completeTour: () => void;
  /** Close the tour for this session without writing anything. */
  dismissTour: () => void;
  /** Open the tour opt-in; never changes setup state. */
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
      if (next.stage === "look") {
        const probe = await withCap(probeExistingLibrary(), 1000);
        if (probe?.hasDocs) {
          // Returning user with a library but no WebView storage: skip both
          // steps, matching the library that is already on disk.
          writeStorage(PREFS_COMPLETE_KEY, "1");
          writeStorage(TOUR_COMPLETE_KEY, "1");
          next = { stage: "done", tourOpen: false };
        } else if (probe?.hasSettings) {
          // Preferences were saved before an import: step 1 is done, but the
          // user still needs the "add a book" step.
          writeStorage(PREFS_COMPLETE_KEY, "1");
          removeStorage(TOUR_COMPLETE_KEY);
          next = { stage: "library", tourOpen: false };
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
    // A stale step-2 flag must never skip the second screen.
    removeStorage(TOUR_COMPLETE_KEY);
    set({ stage: "library", tourOpen: false });
  },
  completeSetup: () => {
    writeStorage(TOUR_COMPLETE_KEY, "1");
    set({ stage: "done", tourOpen: false });
  },
  completeTour: () => {
    writeStorage(TOUR_COMPLETE_KEY, "1");
    set({ stage: "done", tourOpen: false });
  },
  dismissTour: () => set({ tourOpen: false }),
  replayTour: () => set({ tourOpen: true }),
}));
