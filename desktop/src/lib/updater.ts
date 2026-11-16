// E5 (Phase 4 Step 4.4): user-initiated updater.
//
// The check is never automatic — it runs only when the user presses
// "Check for updates" in Settings. Tauri's updater plugin verifies the
// signature of the release manifest (tauri.conf → plugins.updater.pubkey)
// before any download is offered. `withRelaunch` hands the result to the
// caller so the Settings screen can message and confirm before restarting.
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateCheckResult {
  /** "upToDate" | an available version | an error message. */
  status: "upToDate" | "available" | "error";
  /** Present when status === "available". */
  version?: string;
  notes?: string;
  message?: string;
}

/**
 * Check the configured endpoint for a signed update. Returns a plain result
 * the UI can render; it never throws (network failures are messages).
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  try {
    const update: Update | null = await check();
    if (!update) return { status: "upToDate" };
    return {
      status: "available",
      version: update.version,
      notes: update.body ?? "",
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "The update check failed.",
    };
  }
}

/** Download, verify, install and relaunch. Only call after a user confirms. */
export async function downloadAndInstallUpdate(): Promise<void> {
  const update = await check();
  if (!update) return;
  await update.downloadAndInstall();
  await relaunch();
}
