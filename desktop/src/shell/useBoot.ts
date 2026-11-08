import { useEffect } from "react";
import { recoverInterruptedRestore } from "../backup/backupService";
import { filesFromTauriDrop, pickImportFiles } from "../lib/fileSource";
import { onLaunch, takePendingLaunch } from "../lib/openWith";
import { useOnboarding } from "../onboarding/onboardingState";
import { useRouteStore } from "../store/routeStore";
import { getLibraryFs, LIBRARY_ROOT, useLibraryUi } from "../store/libraryUi";

/**
 * True once the shell can act on a launch request. Setup and the tour own the
 * keyboard while visible, so imports wait until both are finished.
 */
function interactive(): boolean {
  const state = useOnboarding.getState();
  return state.stage === "done" && !state.tourOpen;
}

/**
 * Boot order matters: recover an interrupted restore before anything reads the
 * library, derive the onboarding stage from the recovered tree, then drain
 * launch requests. Open-with events arriving earlier stay queued in Rust.
 */
export function useBoot(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let running = false;
    let again = false;

    const handle = async () => {
      if (disposed) return;
      if (!interactive()) {
        again = true;
        return;
      }
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const request = await takePendingLaunch();
        if (request.files.length > 0) {
          useRouteStore.getState().setRoute("library");
          const picked = await filesFromTauriDrop(request.files);
          if (picked && picked.length > 0) {
            await useLibraryUi.getState().importPicked(picked);
          }
        }
        if (request.importRequested) {
          useRouteStore.getState().setRoute("library");
          const picked = await pickImportFiles();
          if (picked.length > 0) {
            await useLibraryUi.getState().importPicked(picked);
          }
        }
      } catch {
        // Import failures surface through the global toast host.
      } finally {
        running = false;
        if (again && !disposed) {
          again = false;
          void handle();
        }
      }
    };

    // Readiness can change later (onboarding finishes, the tour is dismissed).
    const unsubscribe = useOnboarding.subscribe(() => {
      if (interactive()) void handle();
    });

    void (async () => {
      try {
        // Register before draining so a launch racing startup is not lost.
        const un = await onLaunch(() => {
          void handle();
        });
        if (disposed) un();
        else unlisten = un;

        try {
          const recovered = await recoverInterruptedRestore(
            getLibraryFs(),
            LIBRARY_ROOT
          );
          if (recovered && !disposed) await useLibraryUi.getState().refresh();
        } catch {
          // Best-effort: a failed cleanup must not block app start.
        }

        if (!disposed) await useOnboarding.getState().boot();
        if (!disposed) await handle();
      } catch {
        // Startup never fails closed; the Library screen reports storage errors.
      }
    })();

    return () => {
      disposed = true;
      unsubscribe();
      unlisten?.();
    };
  }, []);
}
