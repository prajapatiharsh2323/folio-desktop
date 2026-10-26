// Prevent display sleep while reading (04 §11, 07 §5).
//
// The reader owns the timer: Rust only receives on/off. A locator counts as
// reading activity for 45 s; the setting lives in the desktop-only
// user/window.json (`preventSleepWhileReading`, default true — 04 §11).
import { invoke } from "@tauri-apps/api/core";
import type { FileStore } from "../lib/fileStore";
import { libraryLayout as L } from "../lib/libraryPaths";
import { readJsonAsync } from "../store/jsonio";

export const KEEP_AWAKE_ACTIVITY_MS = 45_000;

export interface WindowSettings {
  preventSleepWhileReading?: boolean;
  [key: string]: unknown;
}

/** App data dir (parent of library/). LIBRARY_ROOT = <appDir>/library. */
export const DESKTOP_APP_DIR = "/folio-library";

export async function readPreventSleepSetting(
  fs: FileStore,
  appDir: string = DESKTOP_APP_DIR
): Promise<boolean> {
  const raw = await readJsonAsync<WindowSettings>(fs, L.windowState(appDir));
  // Anything but an explicit `false` keeps the documented default (true).
  return raw?.preventSleepWhileReading !== false;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type SleepInhibitor = (enable: boolean) => Promise<void>;

const tauriInhibitor: SleepInhibitor = async (enable) => {
  if (!isTauri()) return;
  await invoke("prevent_display_sleep", { enable });
};

/**
 * Keeps the display awake while the reader is active and locators keep firing.
 * `tick()` is cheap and safe to poll; the platform call only happens on an
 * actual state transition, so polling never spams Rust.
 */
export class KeepAwakeController {
  private active: boolean | null = null;
  private lastActivityTs = 0;

  constructor(
    private readonly inhibit: SleepInhibitor = tauriInhibitor,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** A locator arrived (or the user turned a page) — start/refresh the window. */
  markActivity(): void {
    this.lastActivityTs = this.now();
  }

  /** True while a locator fired within the last 45 s. */
  shouldStayAwake(): boolean {
    if (this.lastActivityTs === 0) return false;
    return this.now() - this.lastActivityTs < KEEP_AWAKE_ACTIVITY_MS;
  }

  /** Push the desired state to the platform if it changed. */
  async tick(): Promise<boolean> {
    const desired = this.shouldStayAwake();
    if (desired === this.active) return desired;
    this.active = desired;
    try {
      await this.inhibit(desired);
    } catch {
      // A missing platform hook must never break reading.
    }
    return desired;
  }

  /** Route leave / unmount — always releases the inhibitor. */
  async release(): Promise<void> {
    this.lastActivityTs = 0;
    if (this.active === false) return;
    this.active = false;
    try {
      await this.inhibit(false);
    } catch {
      /* ignore */
    }
  }
}
