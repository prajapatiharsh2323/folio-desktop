import { useEffect } from "react";
import { useRouteStore } from "../store/routeStore";
import { Sidebar, type Route } from "./Sidebar";
import { LibraryScreen } from "../screens/LibraryScreen";
import { CollectionsScreen } from "../screens/CollectionsScreen";
import { NotesScreen } from "../screens/NotesScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { ReaderScreen } from "../screens/ReaderScreen";
import { exitFullscreen, toggleFullscreen } from "../lib/fullscreen";
import { hasBlockingOverlay } from "./overlays";
import { ToastHost } from "../components/ToastHost";

/** Single-window shell (02 §3, 03 §5.1): one route stack, sidebar hidden in reader. */
export function Shell() {
  const route = useRouteStore((s) => s.route);
  const setRoute = useRouteStore((s) => s.setRoute);

  const inReader = route === "reader";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target?.closest("input, textarea, select, [contenteditable='true']") ||
        !!target?.isContentEditable;
      if (hasBlockingOverlay()) {
        if (e.key === "Escape" && typing) target?.blur();
        return;
      }
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

  return (
    <div className="folio-app">
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
      <ToastHost />
    </div>
  );
}
