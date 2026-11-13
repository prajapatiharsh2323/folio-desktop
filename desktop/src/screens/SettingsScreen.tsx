import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolioButton } from "../components/FolioButton";
import { FolioChip } from "../components/FolioChip";
import { FolioDialog } from "../components/FolioDialog";
import { FolioSectionHeader } from "../components/FolioSectionHeader";
import { FolioSettingsRow } from "../components/FolioSettingsRow";
import { useThemeStore, type ThemeSetting } from "../theme/theme";
import { getLibraryFs, getLibraryManager, LIBRARY_ROOT, useLibraryUi } from "../store/libraryUi";
import { useReaderStore } from "../store/readerStore";
import { handleError } from "../lib/errorLog";
import { pickBackupDestPath, pickBackupSourcePath } from "../lib/fileSource";
import { DEFAULT_READING_PREFS } from "../model/defaults";
import type { ReadingPrefs } from "../model/types";
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
    if (isTauri()) {
      void invoke<string>("library_path")
        .then(setLibPath)
        .catch(() => {});
      void invoke<string>("log_path")
        .then(setLogPath)
        .catch(() => {});
    }
  }, [loadPrefs, loadStorage]);

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
      // Write only the fields this editor owns; preserve every other key.
      const next = {
        ...current,
        theme: draftPrefs.theme,
        fontFamily: draftPrefs.fontFamily,
        fontSize: draftPrefs.fontSize,
      };
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
      const bytes = await createBackup(getLibraryFs(), LIBRARY_ROOT);
      if (isTauri()) {
        // The Rust command grants the picked path; fs_write_atomic accepts it.
        const path = await pickBackupDestPath("folio-backup.zip");
        if (!path) return;
        await invoke("fs_write_atomic", { path, data: Array.from(bytes) });
      } else {
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "folio-backup.zip";
        a.click();
        URL.revokeObjectURL(url);
      }
      setMessage(`Backup exported (${formatBytes(bytes.length)}).`);
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
      let bytes: Uint8Array | null = null;
      if (isTauri()) {
        const path = await pickBackupSourcePath();
        if (!path) return;
        bytes = new Uint8Array(await invoke<number[]>("fs_read", { path }));
      } else {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".zip";
        const file = await new Promise<File | null>((resolve) => {
          input.onchange = () => resolve(input.files?.[0] ?? null);
          input.click();
        });
        if (!file) return;
        bytes = new Uint8Array(await file.arrayBuffer());
      }
      if (!bytes) return;
      const summary = await inspectBackup(bytes);
      setRestoreFile(bytes);
      setRestoreSummary(summary);
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
    setRestoreSummary(null);
    setRestoreError(null);
    setReplaceConfirmed(false);
  };

  const handleRestore = async () => {
    if (!restoreFile || !restoreSummary) return;
    if (restoreMode === "replace" && !replaceConfirmed) return;
    setBusy(true);
    setMessage(null);
    setRestoreError(null);
    setRestorePhase("reading");
    try {
      const result = await restoreBackup({
        fs: getLibraryFs(),
        root: LIBRARY_ROOT,
        bytes: restoreFile,
        mode: restoreMode,
        onPhase: setRestorePhase,
      });
      // A restore changes every path the library/session caches know about.
      useReaderStore.getState().close();
      await useLibraryUi.getState().refresh();
      setRestoreOpen(false);
      setRestoreFile(null);
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

        <FolioSectionHeader>Reading</FolioSectionHeader>
        <FolioSettingsRow
          title="Default reading preferences"
          helper="Theme, typeface, and text size for books without their own overrides."
          control={
            <FolioButton variant="secondary" onClick={() => void openPrefs()}>
              Edit
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
        {message && <p className="folio-helper">{message}</p>}

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
          title="Welcome tour"
          helper="Review the five-step introduction to Folio."
          control={
            <FolioButton variant="secondary" onClick={replayTour}>
              Replay
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
        <FolioSettingsRow title="Version" helper={__APP_VERSION__} />
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
    </>
  );
}
