import { useEffect } from "react";
import { useRouteStore } from "../store/routeStore";
import { Sidebar, type Route } from "./Sidebar";
import { SyncScheduler } from "../components/SyncScheduler";
import { LibraryScreen } from "../screens/LibraryScreen";
import { CollectionsScreen } from "../screens/CollectionsScreen";
import { NotesScreen } from "../screens/NotesScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { ReaderScreen } from "../screens/ReaderScreen";
import { exitFullscreen, toggleFullscreen } from "../lib/fullscreen";
import { onLaunch, takePendingLaunch } from "../lib/openWith";
import { filesFromTauriDrop, pickImportFiles } from "../lib/fileSource";
import { getLibraryFs, LIBRARY_ROOT, useLibraryUi } from "../store/libraryUi";
import { recoverInterruptedRestore } from "../backup/backupService";

/** Single-window shell (02 §3, 03 §5.1): one route stack, sidebar hidden in reader. */
export function Shell() {
  const route = useRouteStore((s) => s.route);
  const setRoute = useRouteStore((s) => s.setRoute);

  const inReader = route === "reader";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest("input, textarea, select, [contenteditable='true']");
      if (e.key === "F11") {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (
        e.key === "Escape" &&
        !document.querySelector(".folio-overlay") &&
        document.documentElement.classList.contains("folio-fullscreen")
      ) {
        e.preventDefault();
        void exitFullscreen();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setRoute("settings");
        return;
      }
      if (!inReader && (e.ctrlKey || e.metaKey) && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        const routes = ["library", "collections", "notes", "settings"] as const;
        setRoute(routes[Number(e.key) - 1]);
        return;
      }
      if (e.key === "Escape" && typing) {
        (target as HTMLElement).blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inReader, setRoute]);

  // Restore swap is two renames; if the app died between them, put the
  // rollback tree back before the library screen shows an empty shelf.
  useEffect(() => {
    void (async () => {
      try {
        const recovered = await recoverInterruptedRestore(
          getLibraryFs(),
          LIBRARY_ROOT
        );
        if (recovered) await useLibraryUi.getState().refresh();
      } catch {
        // Best-effort: a failed cleanup must not block app start.
      }
    })();
  }, []);

  // Open-with / second-instance file hand-off (09 §3). Register the listener
  // before draining so a launch racing app start cannot be lost.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let running = false;
    let again = false;

    const handle = async () => {
      if (disposed) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const request = await takePendingLaunch();
        if (request.files.length > 0) {
          setRoute("library");
          const picked = await filesFromTauriDrop(request.files);
          if (picked && picked.length > 0) {
            await useLibraryUi.getState().importPicked(picked);
          }
        }
        if (request.importRequested) {
          setRoute("library");
          const picked = await pickImportFiles();
          if (picked.length > 0) {
            await useLibraryUi.getState().importPicked(picked);
          }
        }
      } catch {
        // A failed open must never take the app down; the library screen
        // surfaces import errors through its snackbar.
      } finally {
        running = false;
        // A second Open-with can arrive while the first import is still
        // running; its queued paths must not wait for another launch.
        if (again && !disposed) {
          again = false;
          void handle();
        }
      }
    };

    const onLaunchEvent = () => {
      if (running) again = true;
      else void handle();
    };

    (async () => {
      const un = await onLaunch(onLaunchEvent);
      if (disposed) un();
      else unlisten = un;
      if (!disposed) await handle();
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setRoute]);

  return (
    <div className="folio-app">
      <SyncScheduler />
      <div className="folio-shell">
        {!inReader && <Sidebar route={route} onNavigate={(r: Route) => setRoute(r)} />}
        <main className="folio-main" aria-label="Folio content">
          {route === "library" && <LibraryScreen />}
          {route === "collections" && <CollectionsScreen />}
          {route === "notes" && <NotesScreen />}
          {route === "settings" && <SettingsScreen />}
          {route === "reader" && <ReaderScreen />}
        </main>
      </div>
    </div>
  );
}
