// S1 (Phase 4): rolling automatic backups + stale-backup reminder.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryFileStore, type FileStore } from "../src/lib/fileStore";

const toasts = vi.hoisted(() => ({
  pushed: [] as {
    key?: string;
    tone: string;
    text: string;
    action?: { label: string; run: () => void };
  }[],
}));

vi.mock("../src/shell/toasts", () => ({
  pushToast: (t: {
    key?: string;
    tone: string;
    text: string;
    action?: { label: string; run: () => void };
  }) => {
    toasts.pushed.push(t);
    return "toast-1";
  },
}));

import {
  appDirFromLibraryPath,
  autoBackupIfNeeded,
  backupsDir,
  backupFileName,
  AUTO_BACKUP_AFTER_MS,
  AUTO_BACKUP_KEEP,
  BACKUP_REMINDER_AFTER_MS,
  checkBackupReminder,
  newestBackupAt,
  parseBackupStamp,
  pruneBackups,
  runRollingBackup,
  readAutoBackupSetting,
  writeAutoBackupSetting,
} from "../src/backup/rollingBackup";

const APP = "/folio-library";

function seedBackup(fs: FileStore, name: string): void {
  void fs.writeTextAtomic(`${backupsDir(APP)}/${name}`, "zip-bytes");
}

let fs: MemoryFileStore;

beforeEach(() => {
  fs = new MemoryFileStore();
  toasts.pushed.length = 0;
});

describe("appDirFromLibraryPath", () => {
  it("strips the /library suffix", () => {
    expect(appDirFromLibraryPath("/folio-library/library")).toBe("/folio-library");
    expect(appDirFromLibraryPath("/folio-library/library/")).toBe("/folio-library");
    expect(appDirFromLibraryPath("C:\\Data\\Folio\\library")).toBe("C:\\Data\\Folio");
    // already an app dir → unchanged
    expect(appDirFromLibraryPath("/folio-library")).toBe("/folio-library");
  });
});

describe("backup stamps", () => {
  it("parses the file-name stamp and rejects other names", () => {
    const t = parseBackupStamp("folio-backup-20261116T093000.zip");
    expect(t).toBe(Date.UTC(2026, 10, 16, 9, 30, 0));
    expect(parseBackupStamp("manifest.json")).toBeNull();
    expect(backupFileName(new Date(Date.UTC(2026, 10, 16, 9, 30, 0)))).toBe(
      "folio-backup-20261116T093000.zip",
    );
  });

  it("finds the newest archive by name stamp", async () => {
    seedBackup(fs, "folio-backup-20261101T000000.zip");
    seedBackup(fs, "folio-backup-20261115T120000.zip");
    seedBackup(fs, "notes.txt");
    expect(await newestBackupAt(fs, APP)).toBe(Date.UTC(2026, 10, 15, 12, 0, 0));
    expect(await newestBackupAt(fs, "/somewhere-else")).toBeNull();
  });
});

describe("pruneBackups", () => {
  it("keeps the newest archives and deletes the rest", async () => {
    for (let i = 1; i <= 7; i++) {
      seedBackup(fs, `folio-backup-2026110${i}T000000.zip`);
    }
    const deleted = await pruneBackups(fs, APP);
    expect(deleted).toBe(7 - AUTO_BACKUP_KEEP);
    expect(await newestBackupAt(fs, APP)).toBe(Date.UTC(2026, 10, 7, 0, 0, 0));
    // the two oldest are gone
    expect(await fs.exists(`${backupsDir(APP)}/folio-backup-20261101T000000.zip`)).toBe(false);
    expect(await fs.exists(`${backupsDir(APP)}/folio-backup-20261102T000000.zip`)).toBe(false);
    expect(await fs.exists(`${backupsDir(APP)}/folio-backup-20261103T000000.zip`)).toBe(true);
  });
});

describe("auto-backup settings", () => {
  it("defaults to off and round-trips through user/window.json", async () => {
    expect(await readAutoBackupSetting(fs, APP)).toBe(false);
    await writeAutoBackupSetting(fs, APP, true);
    expect(await readAutoBackupSetting(fs, APP)).toBe(true);
    // unknown keys in window.json survive the write
    await fs.writeTextAtomic(
      `${APP}/user/window.json`,
      JSON.stringify({ preventSleepWhileReading: false, autoBackup: false }),
    );
    await writeAutoBackupSetting(fs, APP, true);
    const raw = JSON.parse(await fs.readText(`${APP}/user/window.json`));
    expect(raw).toMatchObject({ preventSleepWhileReading: false, autoBackup: true });
  });
});

describe("autoBackupIfNeeded", () => {
  const fresh = new Date(Date.UTC(2026, 10, 16, 12, 0, 0));

  it("does nothing when disabled", async () => {
    const run = vi.fn();
    const result = await autoBackupIfNeeded(fs, APP, fresh, run);
    expect(result).toEqual({ ran: false, reason: "disabled" });
    expect(run).not.toHaveBeenCalled();
  });

  it("skips when the newest archive is fresh", async () => {
    await writeAutoBackupSetting(fs, APP, true);
    seedBackup(fs, "folio-backup-20261116T060000.zip"); // 6 h old
    const run = vi.fn();
    const result = await autoBackupIfNeeded(fs, APP, fresh, run);
    expect(result).toEqual({ ran: false, reason: "fresh" });
    expect(run).not.toHaveBeenCalled();
  });

  it("skips a library that has no manifest yet", async () => {
    await writeAutoBackupSetting(fs, APP, true);
    const run = vi.fn();
    const result = await autoBackupIfNeeded(fs, APP, fresh, run);
    expect(result).toEqual({ ran: false, reason: "empty-library" });
    expect(run).not.toHaveBeenCalled();
  });

  it("runs and prunes when the newest archive is older than a day", async () => {
    await writeAutoBackupSetting(fs, APP, true);
    for (let i = 1; i <= 6; i++) {
      seedBackup(fs, `folio-backup-2026110${i}T000000.zip`);
    }
    await fs.writeTextAtomic(`${APP}/library/manifest.json`, "{}");
    const run = vi.fn().mockResolvedValue(undefined);
    const result = await autoBackupIfNeeded(fs, APP, fresh, run);
    expect(result).toEqual({ ran: true, reason: "ran" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(String(run.mock.calls[0][0])).toMatch(
      new RegExp(`^${backupsDir(APP)}/folio-backup-20261116T\\d{6}\\.zip$`),
    );
    // pruned to AUTO_BACKUP_KEEP (one of the six seeded archives is deleted)
    expect(await fs.exists(`${backupsDir(APP)}/folio-backup-20261101T000000.zip`)).toBe(false);
    expect(await fs.exists(`${backupsDir(APP)}/folio-backup-20261102T000000.zip`)).toBe(true);
  });

  it("threshold is one day", () => {
    expect(AUTO_BACKUP_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("runRollingBackup", () => {
  it("does nothing without an exporter (browser mode)", async () => {
    await runRollingBackup(fs, APP, new Date(), null);
    expect((await fs.list(backupsDir(APP)).catch(() => [])).length).toBe(0);
  });

  it("writes one archive then prunes", async () => {
    for (let i = 1; i <= 5; i++) {
      seedBackup(fs, `folio-backup-2026110${i}T000000.zip`);
    }
    const run = vi.fn().mockResolvedValue(undefined);
    await runRollingBackup(fs, APP, new Date(Date.UTC(2026, 10, 16, 9, 0, 0)), run);
    expect(run).toHaveBeenCalledTimes(1);
    const remaining = (await fs.list(backupsDir(APP))).filter(
      (e) => !e.isDir && parseBackupStamp(e.path.replace(/^.*[\\/]/, "")) !== null,
    );
    expect(remaining.length).toBe(AUTO_BACKUP_KEEP);
  });
});

describe("checkBackupReminder", () => {
  const now = new Date(Date.UTC(2026, 10, 16, 12, 0, 0));

  it("stays quiet when a recent backup exists", async () => {
    seedBackup(fs, "folio-backup-20261112T000000.zip"); // 4 days old
    await checkBackupReminder(fs, APP, now, vi.fn());
    expect(toasts.pushed).toHaveLength(0);
  });

  it("stays quiet for an empty library on first run", async () => {
    await checkBackupReminder(fs, APP, now, vi.fn());
    expect(toasts.pushed).toHaveLength(0);
  });

  it("reminds when the newest archive is a week old, with a back-up-now action", async () => {
    seedBackup(fs, "folio-backup-20261101T000000.zip"); // 15 days old
    await fs.writeTextAtomic(`${APP}/library/manifest.json`, "{}");
    const run = vi.fn().mockResolvedValue(undefined);
    await checkBackupReminder(fs, APP, now, run);
    expect(toasts.pushed).toHaveLength(1);
    const toast = toasts.pushed[0];
    expect(toast.tone).toBe("info");
    expect(toast.text).toContain("15 days ago");
    expect(toast.action?.label).toBe("Back up now");
    toast.action?.run();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(String(run.mock.calls[0][0])).toContain(backupsDir(APP));
  });

  it("reminds when there has never been a backup", async () => {
    await fs.writeTextAtomic(`${APP}/library/manifest.json`, "{}");
    await checkBackupReminder(fs, APP, now, vi.fn());
    expect(toasts.pushed[0]?.text).toBe("Your library has never been backed up.");
  });

  it("reminder threshold is one week", () => {
    expect(BACKUP_REMINDER_AFTER_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
