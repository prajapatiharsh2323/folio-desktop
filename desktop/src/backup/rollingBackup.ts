// S1 (Phase 4): rolling automatic backups + the stale-backup reminder.
//
// Automatic backups write into the app data dir (`<appDir>/user/backups/`,
// next to — not inside — the library root), so archives never back each other
// up. The newest backup is recognised by its file-name stamp
// (`folio-backup-<YYYYMMDDTHHMMSS>.zip`), which doubles as the sort key for
// pruning. When automatic backups are enabled, boot runs one if the newest
// archive is older than a day and prunes to the last few; independently, a
// reminder toast fires when the newest archive (from any source) is older
// than a week.
//
// `<appDir>` is derived at runtime by stripping the `/library` suffix from the
// real `library_path` invoke result — `..` segments are rejected by the Rust
// path guard, so the parent must be reconstructed from an absolute child.

import { invoke } from "@tauri-apps/api/core";
import type { FileStore } from "../lib/fileStore";
import { readJsonAsync, writeJsonAtomic } from "../store/jsonio";
import { pushToast } from "../shell/toasts";

export const BACKUP_FILE_RE = /^folio-backup-(\d{8}T\d{6})\.zip$/;
export const AUTO_BACKUP_KEEP = 5;
/** Run an automatic backup when the newest archive is older than this. */
export const AUTO_BACKUP_AFTER_MS = 24 * 60 * 60 * 1000;
/** Remind (toast) when the newest archive is older than this. */
export const BACKUP_REMINDER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `/folio-library/library` → `/folio-library` (Windows separators too). */
export function appDirFromLibraryPath(libraryPath: string): string {
  return libraryPath.replace(/[\\/]+library[\\/]*$/, "") || libraryPath;
}

export function backupsDir(appDir: string): string {
  return `${appDir.replace(/[\\/]+$/, "")}/user/backups`;
}

/** File-name stamp → epoch ms (null when the name is not a backup archive). */
export function parseBackupStamp(name: string): number | null {
  const m = BACKUP_FILE_RE.exec(name);
  if (!m) return null;
  const s = m[1];
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const h = Number(s.slice(9, 11));
  const mi = Number(s.slice(11, 13));
  const sec = Number(s.slice(13, 15));
  const t = Date.UTC(y, mo - 1, d, h, mi, sec);
  return Number.isFinite(t) ? t : null;
}

/** Newest archive's epoch ms, or null when the folder holds no backups. */
export async function newestBackupAt(fs: FileStore, appDir: string): Promise<number | null> {
  let entries;
  try {
    entries = await fs.list(backupsDir(appDir));
  } catch {
    return null; // no backups directory yet
  }
  let newest: number | null = null;
  for (const e of entries) {
    if (e.isDir) continue;
    const t = parseBackupStamp(e.path.replace(/^.*[\\/]/, ""));
    if (t !== null && (newest === null || t > newest)) newest = t;
  }
  return newest;
}

/** Keep the newest `keep` archives; delete the rest (missing dir is fine). */
export async function pruneBackups(
  fs: FileStore,
  appDir: string,
  keep: number = AUTO_BACKUP_KEEP,
): Promise<number> {
  const entries = await fs.list(backupsDir(appDir));
  const stamps = entries
    .filter((e) => !e.isDir && parseBackupStamp(e.path.replace(/^.*[\\/]/, "")) !== null)
    .sort((a, b) => b.path.localeCompare(a.path));
  let deleted = 0;
  for (const e of stamps.slice(keep)) {
    await fs.delete(e.path);
    deleted += 1;
  }
  return deleted;
}

/** Automatic-backup preference (user/window.json, desktop-only, default off). */
export async function readAutoBackupSetting(fs: FileStore, appDir: string): Promise<boolean> {
  const raw = await readJsonAsync<{ autoBackup?: unknown }>(fs, `${appDir}/user/window.json`);
  return raw?.autoBackup === true;
}

export async function writeAutoBackupSetting(
  fs: FileStore,
  appDir: string,
  enabled: boolean,
): Promise<void> {
  const path = `${appDir}/user/window.json`;
  const raw = await readJsonAsync<Record<string, unknown>>(fs, path);
  await writeJsonAtomic(fs, path, { ...(raw ?? {}), autoBackup: enabled });
}

export type BackupExporter = (destPath: string) => Promise<unknown>;

/** Default exporter: the Rust streaming command (Tauri only). */
function defaultExporter(): BackupExporter | null {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  return (destPath) => invoke("backup_export", { destPath });
}

export function backupFileName(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `folio-backup-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(
    now.getUTCDate(),
  )}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}.zip`;
}

/** Write one rolling archive into user/backups and prune older ones. */
export async function runRollingBackup(
  fs: FileStore,
  appDir: string,
  now: Date = new Date(),
  exportFn: BackupExporter | null = defaultExporter(),
): Promise<void> {
  if (!exportFn) return; // browser mode has no streaming exporter
  const dest = `${backupsDir(appDir)}/${backupFileName(now)}`;
  await exportFn(dest);
  await pruneBackups(fs, appDir);
}

export interface AutoBackupResult {
  ran: boolean;
  reason: "disabled" | "fresh" | "empty-library" | "ran";
}

/**
 * Boot-time automatic backup: only when enabled and the newest archive is
 * stale. A library without a manifest cannot be backed up; skip quietly.
 */
export async function autoBackupIfNeeded(
  fs: FileStore,
  appDir: string,
  now: Date = new Date(),
  exportFn: BackupExporter | null = defaultExporter(),
): Promise<AutoBackupResult> {
  if (!(await readAutoBackupSetting(fs, appDir))) return { ran: false, reason: "disabled" };
  const newest = await newestBackupAt(fs, appDir);
  if (newest !== null && now.getTime() - newest < AUTO_BACKUP_AFTER_MS) {
    return { ran: false, reason: "fresh" };
  }
  if (!(await fs.exists(`${appDir}/library/manifest.json`))) {
    return { ran: false, reason: "empty-library" };
  }
  await runRollingBackup(fs, appDir, now, exportFn);
  return { ran: true, reason: "ran" };
}

/**
 * Boot-time reminder: an info toast when the newest archive of any kind is
 * missing or older than a week. The action backs up immediately (same rolling
 * folder, no native dialog).
 */
export async function checkBackupReminder(
  fs: FileStore,
  appDir: string,
  now: Date = new Date(),
  exportFn: BackupExporter | null = defaultExporter(),
): Promise<void> {
  const newest = await newestBackupAt(fs, appDir);
  const age = newest === null ? Number.POSITIVE_INFINITY : now.getTime() - newest;
  if (age < BACKUP_REMINDER_AFTER_MS) return;
  // An empty library (no manifest yet, e.g. first run) has nothing to back up.
  if (newest === null && !(await fs.exists(`${appDir}/library/manifest.json`))) return;
  const days = newest === null ? null : Math.floor(age / DAY_MS);
  const text =
    days === null
      ? "Your library has never been backed up."
      : `Your last backup was ${days} day${days === 1 ? "" : "s"} ago.`;
  pushToast({
    key: "backup-reminder",
    tone: "info",
    text,
    action: {
      label: "Back up now",
      run: () => {
        void runRollingBackup(fs, appDir, new Date(), exportFn)
          .then(() =>
            pushToast({ key: "backup-reminder", tone: "success", text: "Backup created." }),
          )
          .catch(() =>
            pushToast({
              key: "backup-reminder",
              tone: "error",
              text: "The backup could not be created.",
            }),
          );
      },
    },
  });
}
