import { useEffect } from "react";
import { hasRefreshToken } from "../sync/auth";
import { readSyncState } from "../sync/state";
import { useSyncStatus } from "../sync/status";
import { getLibraryFs } from "../store/libraryUi";
import { DESKTOP_APP_DIR } from "../reader/keepAwake";

const AUTO_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Global auto-sync loop. Mounted once in the shell so it is independent of the
 * Settings screen (09 §2: "auto-sync 15 min while app open").
 */
export function SyncScheduler() {
  const auto = useSyncStatus((s) => s.auto);
  const signedIn = useSyncStatus((s) => s.signedIn);
  const setSignedIn = useSyncStatus((s) => s.setSignedIn);
  const setChecking = useSyncStatus((s) => s.setChecking);
  const runNow = useSyncStatus((s) => s.runNow);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const token = await hasRefreshToken();
      if (disposed) return;
      setSignedIn(token);
      setChecking(false);
      try {
        const state = await readSyncState(getLibraryFs(), DESKTOP_APP_DIR);
        if (!disposed && state.lastSyncAt) {
          useSyncStatus.setState({ lastSyncAt: state.lastSyncAt });
        }
      } catch {
        /* state is best-effort */
      }
    })();
    return () => {
      disposed = true;
    };
  }, [setSignedIn, setChecking]);

  useEffect(() => {
    if (!auto || !signedIn) return;
    const timer = window.setInterval(() => {
      void runNow();
    }, AUTO_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [auto, signedIn, runNow]);

  return null;
}
