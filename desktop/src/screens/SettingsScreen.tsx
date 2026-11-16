import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolioButton } from "../components/FolioButton";
import { FolioChip } from "../components/FolioChip";
import { FolioDialog } from "../components/FolioDialog";
import { FolioSectionHeader } from "../components/FolioSectionHeader";
import { FolioSettingsRow } from "../components/FolioSettingsRow";
import { KeyboardShortcutsDialog } from "../components/KeyboardShortcutsDialog";
import { useThemeStore, type ThemeSetting } from "../theme/theme";
import { getLibraryFs, getLibraryManager, LIBRARY_ROOT, useLibraryUi } from "../store/libraryUi";
import { useReaderStore } from "../store/readerStore";
import { handleError } from "../lib/errorLog";
import { pickBackupDestPath, pickBackupSourcePath } from "../lib/fileSource";
import { applyUiZoom, readUiZoom, UI_ZOOM_STEPS } from "../lib/uiZoom";
import { readPreventSleepSetting } from "../reader/keepAwake";
import { readJsonAsync, writeJsonAtomic } from "../store/jsonio";
import { writeStorage, readStorage } from "../lib/storage";
import { reindexDocs } from "../backup/reindex";
import { DEFAULT_READING_PREFS } from "../model/defaults";
import type { LibrarySort } from "../lib/libraryView";
import type { ReadingPrefs } from "../model/types";
import thirdPartyNotices from "../../THIRD-PARTY-NOTICES.md?raw";
import { PreferencesEditor } from "../onboarding/PreferencesEditor";
import { useOnboarding } from "../onboarding/onboardingState";
import {
  createBackup,
  inspectBackup,
  restoreBackup,
  type BackupSummary,
  type RestorePhase,
  type RestoreResult,
} from "../backup/backupService";

/** S1: default library sort/view (persisted; the library reads these keys). */
const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: "recent", label: "Recent activity" },
  { value: "dateadded", label: "Date added" },
  { value: "progress", label: "Progress" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
];

const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const PHASE_LABEL: Record<RestorePhase, string> = {
  reading: "Reading archive…",
  extracting: "Extracting files…",
  validating: "Validating backup…",
  applying: "Applying backup…",
  indexing: "Rebuilding search index…",
  done: "Finished",
};

function describeRestore(result: RestoreResult): string {
  if (result.mode === "replace") {
    return `Library replaced: ${result.addedDocs} document${
      result.addedDocs === 1 ? "" : "s"
    } restored.`;
  }
  const parts = [`${result.addedDocs} new document${result.addedDocs === 1 ? "" : "s"} added`];
  if (result.annotationsMerged > 0) {
    parts.push(
      `${result.annotationsMerged} annotation${result.annotationsMerged === 1 ? "" : "s"} merged`,
    );
  }
  if (result.progressMerged > 0) {
    parts.push(
      `${result.progressMerged} reading position${result.progressMerged === 1 ? "" : "s"} updated`,
    );
  }
  if (result.skippedDocs.length > 0) {
    parts.push(`${result.skippedDocs.length} skipped`);
  }
  return `Merge complete: ${parts.join(", ")}.`;
}

function formatDate(iso: string): string {
  if (!iso) return "Unknown date";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Settings screen (03 §5.7, 06 §4). */
export function SettingsScreen() {
  const setting = useThemeStore((s) => s.setting);
  const setSetting = useThemeStore((s) => s.setSetting);

  const [defaultPrefs, setDefaultPrefs] = useState<ReadingPrefs>(DEFAULT_READING_PREFS);
  const [storageInfo, setStorageInfo] = useState<{ size: number; free: number } | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [restoreFile, setRestoreFile] = useState<Uint8Array | null>(null);
  /** S2: Tauri keeps the picked path and reads the bytes only on restore. */
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<BackupSummary | null>(null);
  const [restorePhase, setRestorePhase] = useState<RestorePhase | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [libPath, setLibPath] = useState(LIBRARY_ROOT);
  const [logPath, setLogPath] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [draftPrefs, setDraftPrefs] = useState<ReadingPrefs>(DEFAULT_READING_PREFS);
  const replayTour = useOnboarding((s) => s.replayTour);

  // ---- S1: keep-awake, UI zoom, default library sort/view, reindex ---------
  const [keepAwake, setKeepAwake] = useState(true);
  const [uiZoom, setUiZoom] = useState<number>(() => readUiZoom());
  const [defaultSort, setDefaultSort] = useState<LibrarySort>(
    () => (readStorage("folio.library.sort") as LibrarySort) || "recent",
  );
  const [defaultView, setDefaultView] = useState<"list" | "grid">(() =>
    readStorage("folio.library.view") === "grid" ? "grid" : "list",
  );
  const [licencesOpen, setLicencesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const loadKeepAwake = useCallback(async () => {
    try {
      setKeepAwake(await readPreventSleepSetting(getLibraryFs()));
    } catch (e) {
      handleError(e, { context: "settings.keepawake.load" });
    }
  }, []);

  const setPreventSleep = async (enable: boolean) => {
    setKeepAwake(enable);
    try {
      // user/window.json is desktop-only and excluded from backups (02 §3).
      const fs = getLibraryFs();
      const path = "/folio-library/user/window.json";
      const raw = await readJsonAsync<Record<string, unknown>>(fs, path);
      await writeJsonAtomic(fs, path, { ...(raw ?? {}), preventSleepWhileReading: enable });
      setMessage(
        enable ? "Display sleep is allowed again." : "The display will stay awake while reading.",
      );
    } catch (e) {
      handleError(e, { context: "settings.keepawake.save" });
      setKeepAwake(!enable);
      setMessage(e instanceof Error ? e.message : "That setting could not be saved.");
    }
  };

  const setZoom = (percent: number) => {
    setUiZoom(applyUiZoom(percent));
  };

  const setSort = (s: LibrarySort) => {
    setDefaultSort(s);
    writeStorage("folio.library.sort", s);
  };

  const setView = (v: "list" | "grid") => {
    setDefaultView(v);
    writeStorage("folio.library.view", v);
  };

  const rebuildIndex = async () => {
    setBusy(true);
    setMessage("Rebuilding the search index…");
    try {
      const fs = getLibraryFs();
      const lm = getLibraryManager();
      const manifest = await lm.load();
      const docIds = (manifest?.docs ?? []).map((d) => d.id);
      // Drop every derived page/chapter text file, then regenerate them.
      const textDir = `${LIBRARY_ROOT}/index/text`;
      const entries = await fs.list(textDir).catch(() => []);
      for (const e of entries) {
        if (!e.isDir) await fs.delete(e.path).catch(() => {});
      }
      const result = await reindexDocs(fs, LIBRARY_ROOT, docIds);
      const failures = result.failed.length;
      setMessage(
        failures === 0
          ? `Search index rebuilt (${result.indexed} document${result.indexed === 1 ? "" : "s"}).`
          : `Search index rebuilt with ${failures} failure${failures === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      handleError(e, { context: "settings.reindex" });
      setMessage(e instanceof Error ? e.message : "The search index could not be rebuilt.");
    } finally {
      setBusy(false);
    }
  };

  const copyDiagnostics = async () => {
    try {
      const info = [
        `Folio ${__APP_VERSION__}`,
        `Platform: ${navigator.userAgent}`,
        `Host: ${isTauri() ? "desktop (Tauri)" : "browser"}`,
      ].join("\n");
      await navigator.clipboard.writeText(info);
      setMessage("Diagnostics copied to the clipboard.");
    } catch (e) {
      handleError(e, { context: "settings.diagnostics" });
      setMessage("The diagnostics could not be copied.");
    }
  };

  const loadPrefs = useCallback(async () => {
    try {
      const lm = getLibraryManager();
      setDefaultPrefs(await lm.prefs.global());
    } catch (e) {
      handleError(e, { context: "settings.prefs.load" });
    }
  }, []);

  const loadStorage = useCallback(async () => {
    try {
      const fs = getLibraryFs();
      // Sum sizes of all files under the library root.
      let size = 0;
      const walk = async (dir: string) => {
        const entries = await fs.list(dir);
        for (const e of entries) {
          if (e.isDir) await walk(e.path);
          else {
            const st = await fs.stat(e.path);
            if (st) size += st.size;
          }
        }
      };
      await walk(LIBRARY_ROOT);
      const free = await fs.freeSpace();
      setStorageInfo({ size, free });
    } catch (e) {
      handleError(e, { context: "settings.storage" });
      setStorageInfo(null);
    }
  }, []);

  useEffect(() => {
    void loadPrefs();
    void loadStorage();
    void loadKeepAwake();
    if (isTauri()) {
      void invoke<string>("library_path")
        .then(setLibPath)
        .catch(() => {});
      void invoke<string>("log_path")
        .then(setLogPath)
        .catch(() => {});
    }
  }, [loadPrefs, loadStorage, loadKeepAwake]);

  const openPrefs = async () => {
    setMessage(null);
    try {
      setDraftPrefs(await getLibraryManager().prefs.global());
    } catch (e) {
      handleError(e, { context: "settings.prefs.load" });
      setDraftPrefs(defaultPrefs);
    }
    setPrefsOpen(true);
  };

  const savePrefs = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const lm = getLibraryManager();
      const current = await lm.prefs.global();
      // S1a: the editor owns the whole pref shape; preserve unknown keys
      // (schema-1) and write everything it displays, not just three fields.
      const next: ReadingPrefs = { ...current, ...draftPrefs };
      await lm.prefs.writeGlobal(next);
      setDefaultPrefs(next);
      setPrefsOpen(false);
      setMessage("Default reading preferences saved.");
    } catch (e) {
      handleError(e, {
        context: "settings.prefs.save",
        userMessage:
          e instanceof Error ? e.message : "Default reading preferences could not be saved.",
      });
      setMessage(
        e instanceof Error ? e.message : "Default reading preferences could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (isTauri()) {
        // S2: the Rust command streams the library into the destination ZIP —
        // no archive-sized buffer in the webview — verifies the archive after
        // the write, and reports progress via folio://backup-progress.
        const path = await pickBackupDestPath("folio-backup.zip");
        if (!path) return;
        let unlisten: (() => void) | undefined;
        try {
          const { listen } = await import("@tauri-apps/api/event");
          unlisten = await listen<{ done: number; total: number }>(
            "folio://backup-progress",
            (event) => {
              const p = event.payload;
              if (p && p.total > 0 && p.done < p.total) {
                setMessage(`Backing up… ${p.done} of ${p.total} files`);
              }
            },
          );
        } catch {
          /* progress display is best-effort; export proceeds without it */
        }
        try {
          const summary = await invoke<
            {
              compressedBytes: number;
            } & BackupSummary
          >("backup_export", { destPath: path });
          setMessage(`Backup exported (${formatBytes(summary.compressedBytes)}) — verified.`);
        } finally {
          unlisten?.();
        }
      } else {
        const bytes = await createBackup(getLibraryFs(), LIBRARY_ROOT);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "folio-backup.zip";
        a.click();
        URL.revokeObjectURL(url);
        setMessage(`Backup exported (${formatBytes(bytes.length)}).`);
      }
    } catch (e) {
      handleError(e, { context: "settings.backup.export" });
      setMessage(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const handlePickRestore = async () => {
    setMessage(null);
    setRestoreError(null);
    try {
      if (isTauri()) {
        // S2: inspect without loading the archive — the Rust command reads
        // only the central directory and metadata. The bytes are read later,
        // when the user actually confirms the restore.
        const path = await pickBackupSourcePath();
        if (!path) return;
        const summary = await invoke<BackupSummary>("backup_inspect", { path });
        setRestorePath(path);
        setRestoreFile(null);
        setRestoreSummary(summary);
      } else {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".zip";
        const file = await new Promise<File | null>((resolve) => {
          input.onchange = () => resolve(input.files?.[0] ?? null);
          input.click();
        });
        if (!file) return;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const summary = await inspectBackup(bytes);
        setRestorePath(null);
        setRestoreFile(bytes);
        setRestoreSummary(summary);
      }
      setRestoreMode("merge");
      setReplaceConfirmed(false);
      setRestoreOpen(true);
    } catch (e) {
      handleError(e, { context: "settings.backup.inspect" });
      setMessage(e instanceof Error ? e.message : "This file could not be read as a backup.");
    }
  };

  const closeRestore = () => {
    if (busy) return;
    setRestoreOpen(false);
    setRestoreFile(null);
    setRestorePath(null);
    setRestoreSummary(null);
    setRestoreError(null);
    setReplaceConfirmed(false);
  };

  const handleRestore = async () => {
    if ((!restoreFile && !restorePath) || !restoreSummary) return;
    if (restoreMode === "replace" && !replaceConfirmed) return;
    setBusy(true);
    setMessage(null);
    setRestoreError(null);
    setRestorePhase("reading");
    try {
      // S2: the archive bytes are only loaded here, after the user confirms.
      const bytes =
        restoreFile ?? new Uint8Array(await invoke<ArrayBuffer>("fs_read", { path: restorePath }));
      const result = await restoreBackup({
        fs: getLibraryFs(),
        root: LIBRARY_ROOT,
        bytes,
        mode: restoreMode,
        onPhase: setRestorePhase,
      });
      // A restore changes every path the library/session caches know about.
      useReaderStore.getState().close();
      await useLibraryUi.getState().refresh();
      setRestoreOpen(false);
      setRestoreFile(null);
      setRestorePath(null);
      setRestoreSummary(null);
      setReplaceConfirmed(false);
      setMessage(describeRestore(result));
      await loadStorage();
    } catch (e) {
      handleError(e, { context: "settings.backup.restore" });
      setRestoreError(
        e instanceof Error ? e.message : "Restore failed; your library was not changed.",
      );
    } finally {
      setBusy(false);
      setRestorePhase(null);
    }
  };

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      <header className="folio-toolbar">
        <div className="folio-toolbar__titles">
          <div className="folio-toolbar__title">Settings</div>
        </div>
      </header>
      <div className="folio-screen">
        <FolioSectionHeader>Appearance</FolioSectionHeader>
        <FolioSettingsRow
          title="App appearance"
          helper="Light, dark, or follow your system setting"
          control={
            <div role="group" aria-label="App appearance">
              {THEME_OPTIONS.map((o) => (
                <FolioChip
                  key={o.value}
                  selected={setting === o.value}
                  onClick={() => setSetting(o.value)}
                  style={{ marginRight: 8 }}
                >
                  {o.label}
                </FolioChip>
              ))}
            </div>
          }
        />
        <FolioSettingsRow
          title="Interface zoom"
          helper="Scales Folio's controls and text from 80% to 150%"
          control={
            <div role="group" aria-label="Interface zoom">
              {UI_ZOOM_STEPS.map((z) => (
                <FolioChip
                  key={z}
                  selected={uiZoom === z}
                  onClick={() => setZoom(z)}
                  style={{ marginRight: 8 }}
                >
                  {z}%
                </FolioChip>
              ))}
            </div>
          }
        />

        <FolioSectionHeader>Reading</FolioSectionHeader>
        <FolioSettingsRow
          title="Default reading preferences"
          helper="Theme, typeface, text size, spacing, flow and more for books without their own overrides."
          control={
            <FolioButton variant="secondary" onClick={() => void openPrefs()}>
              Edit
            </FolioButton>
          }
        />
        <FolioSettingsRow
          title="Keep screen awake"
          helper="While you are actively reading, keep the display from sleeping"
          control={
            <div role="group" aria-label="Keep screen awake">
              <FolioChip selected={keepAwake} onClick={() => void setPreventSleep(true)}>
                On
              </FolioChip>
              <FolioChip
                selected={!keepAwake}
                onClick={() => void setPreventSleep(false)}
                style={{ marginLeft: 8 }}
              >
                Off
              </FolioChip>
            </div>
          }
        />

        <FolioSectionHeader>Library</FolioSectionHeader>
        <FolioSettingsRow
          title="Default sort"
          helper="Applied when the library opens"
          control={
            <select
              className="folio-filter-select"
              value={defaultSort}
              aria-label="Default library sort"
              onChange={(e) => setSort(e.target.value as LibrarySort)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          }
        />
        <FolioSettingsRow
          title="Default view"
          helper="List rows or the cover grid"
          control={
            <div role="group" aria-label="Default library view">
              <FolioChip selected={defaultView === "list"} onClick={() => setView("list")}>
                List
              </FolioChip>
              <FolioChip
                selected={defaultView === "grid"}
                onClick={() => setView("grid")}
                style={{ marginLeft: 8 }}
              >
                Grid
              </FolioChip>
            </div>
          }
        />
        <FolioSettingsRow
          title="Rebuild search index"
          helper="Regenerates the derived per-book text index; use when library search misses a book"
          control={
            <FolioButton variant="secondary" onClick={() => void rebuildIndex()} disabled={busy}>
              Rebuild
            </FolioButton>
          }
        />

        <FolioSectionHeader>Backup</FolioSectionHeader>
        <FolioSettingsRow
          title="Export backup"
          helper="Save a zip of your library and settings"
          control={
            <FolioButton variant="secondary" onClick={() => void handleExport()} disabled={busy}>
              Export
            </FolioButton>
          }
        />
        <FolioSettingsRow
          title="Restore backup"
          helper="Merge or replace with a backup zip"
          control={
            <FolioButton
              variant="secondary"
              onClick={() => void handlePickRestore()}
              disabled={busy}
            >
              Restore
            </FolioButton>
          }
        />
        {message && (
          <p className="folio-helper" role="status">
            {message}
          </p>
        )}

        <FolioSectionHeader>Storage</FolioSectionHeader>
        <FolioSettingsRow
          title="Library size"
          helper={storageInfo ? formatBytes(storageInfo.size) : "—"}
        />
        <FolioSettingsRow
          title="Free space"
          helper={storageInfo ? formatBytes(storageInfo.free) : "—"}
        />
        <FolioSettingsRow
          title="Library folder"
          helper={isTauri() ? libPath : "Available in the desktop app."}
          control={
            <FolioButton
              variant="secondary"
              disabled={!isTauri()}
              onClick={() => {
                if (!isTauri()) return;
                void invoke("open_app_dir").catch(() => {
                  setMessage("The library folder could not be opened.");
                });
              }}
            >
              Open
            </FolioButton>
          }
        />

        <FolioSectionHeader>About</FolioSectionHeader>
        <FolioSettingsRow
          title="Keyboard shortcuts"
          helper="Every reader and library shortcut on one page"
          control={
            <FolioButton variant="secondary" onClick={() => setShortcutsOpen(true)}>
              View
            </FolioButton>
          }
        />
        <FolioSettingsRow
          title="Welcome tour"
          helper="Review the five-step introduction to Folio."
          control={
            <FolioButton variant="secondary" onClick={replayTour}>
              Replay
            </FolioButton>
          }
        />
        <FolioSettingsRow
          title="Privacy"
          helper="Folio works entirely offline: no telemetry, no accounts, no network requests. Your library never leaves this machine unless you export it."
        />
        <FolioSettingsRow
          title="Open-source licences"
          helper="React, Zustand, Readium, fflate and pdf.js"
          control={
            <FolioButton variant="secondary" onClick={() => setLicencesOpen(true)}>
              View
            </FolioButton>
          }
        />
        <FolioSettingsRow
          title="Copy diagnostics"
          helper="Version and platform details for bug reports — copied to your clipboard"
          control={
            <FolioButton variant="secondary" onClick={() => void copyDiagnostics()}>
              Copy
            </FolioButton>
          }
        />
        <FolioSettingsRow
          title="Check for updates"
          helper="Updates will arrive with signed releases (E5); this build has no updater."
          control={
            <FolioButton variant="secondary" disabled>
              Check
            </FolioButton>
          }
        />
        <FolioSettingsRow
          title="Error log"
          helper={
            isTauri()
              ? logPath || "Local diagnostics; nothing is uploaded."
              : "Available in the desktop app."
          }
          control={
            <FolioButton
              variant="secondary"
              disabled={!isTauri()}
              onClick={() => {
                if (!isTauri()) return;
                setMessage(null);
                void invoke("open_log_dir").catch(() => {
                  setMessage("The log folder could not be opened.");
                });
              }}
            >
              Open log folder
            </FolioButton>
          }
        />
        <FolioSettingsRow title="Version" helper={`Folio ${__APP_VERSION__}`} />
      </div>

      <FolioDialog
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        title="Default reading preferences"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setPrefsOpen(false)} disabled={busy}>
              Cancel
            </FolioButton>
            <FolioButton variant="primary" onClick={() => void savePrefs()} disabled={busy}>
              Save
            </FolioButton>
          </>
        }
      >
        <PreferencesEditor prefs={draftPrefs} onChange={setDraftPrefs} />
        <p className="folio-helper">Changes made inside a book stay with that book.</p>
      </FolioDialog>

      <FolioDialog
        open={restoreOpen}
        onClose={closeRestore}
        title="Restore backup"
        actions={
          <>
            <FolioButton variant="secondary" onClick={closeRestore} disabled={busy}>
              Cancel
            </FolioButton>
            <FolioButton
              variant={restoreMode === "replace" ? "danger" : "primary"}
              onClick={() => void handleRestore()}
              disabled={busy || (restoreMode === "replace" && !replaceConfirmed)}
            >
              {restoreMode === "replace" ? "Replace library" : "Merge backup"}
            </FolioButton>
          </>
        }
      >
        {restoreSummary && (
          <div className="folio-helper" style={{ marginBottom: 12 }}>
            <div>
              Backup from {formatDate(restoreSummary.createdAt)}
              {restoreSummary.appVersion ? ` · Folio ${restoreSummary.appVersion}` : ""}
            </div>
            <div>
              {restoreSummary.docCount} document{restoreSummary.docCount === 1 ? "" : "s"} ·{" "}
              {restoreSummary.fileCount} file{restoreSummary.fileCount === 1 ? "" : "s"} ·{" "}
              {formatBytes(restoreSummary.uncompressedBytes)}
            </div>
            {restoreSummary.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        )}

        <div
          role="group"
          aria-label="Restore mode"
          style={{ display: "flex", gap: 8, marginBottom: 12 }}
        >
          <FolioChip
            selected={restoreMode === "merge"}
            onClick={() => setRestoreMode("merge")}
            disabled={busy}
          >
            Merge
          </FolioChip>
          <FolioChip
            selected={restoreMode === "replace"}
            onClick={() => {
              setRestoreMode("replace");
              setReplaceConfirmed(false);
            }}
            disabled={busy}
          >
            Replace
          </FolioChip>
        </div>
        <p className="folio-helper">
          {restoreMode === "merge"
            ? "Adds books that are missing and merges notes, progress and collections. Your current library is kept."
            : "Replaces the entire library with this backup. Your current library is kept only until the restore is verified."}
        </p>

        {restoreMode === "replace" && !busy && (
          <label className="folio-helper" style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              type="checkbox"
              checked={replaceConfirmed}
              onChange={(e) => setReplaceConfirmed(e.target.checked)}
            />
            I understand this replaces my current library.
          </label>
        )}

        {busy && restorePhase && (
          <p className="folio-helper" role="status" style={{ marginTop: 12 }}>
            {PHASE_LABEL[restorePhase]}
          </p>
        )}

        {restoreError && (
          <p
            className="folio-helper"
            role="alert"
            style={{ marginTop: 12, color: "var(--folio-danger)" }}
          >
            {restoreError}
          </p>
        )}
      </FolioDialog>

      {/* S3: bundled third-party notices (vite ?raw import, no runtime fetch). */}
      <FolioDialog
        open={licencesOpen}
        onClose={() => setLicencesOpen(false)}
        title="Open-source licences"
        actions={
          <FolioButton variant="secondary" onClick={() => setLicencesOpen(false)}>
            Close
          </FolioButton>
        }
      >
        <pre className="folio-licences">{thirdPartyNotices}</pre>
      </FolioDialog>

      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
