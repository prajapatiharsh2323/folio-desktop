// Open-with / second-instance hand-off (09 §3). Rust queues file paths and
// emits `folio://launch`; the frontend drains the queue so no event is missed.
import { invoke } from "@tauri-apps/api/core";

export const LAUNCH_EVENT = "folio://launch";

export interface LaunchRequest {
  files: string[];
  importRequested: boolean;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface RawLaunch {
  files?: string[];
  import_requested?: boolean;
}

/** Drain queued paths. Safe to call repeatedly. */
export async function takePendingLaunch(): Promise<LaunchRequest> {
  if (!isTauri()) return { files: [], importRequested: false };
  try {
    const raw = await invoke<RawLaunch>("take_pending_launch");
    return {
      files: raw?.files ?? [],
      importRequested: raw?.import_requested ?? false,
    };
  } catch {
    return { files: [], importRequested: false };
  }
}

/** Subscribe to second-instance launches. Returns an unsubscribe function. */
export async function onLaunch(listener: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen(LAUNCH_EVENT, () => listener());
  } catch {
    return () => {};
  }
}
