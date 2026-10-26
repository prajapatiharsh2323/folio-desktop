import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolioButton } from "../components/FolioButton";
import { FolioChip } from "../components/FolioChip";
import { FolioDialog } from "../components/FolioDialog";
import { FolioSectionHeader } from "../components/FolioSectionHeader";
import { FolioSettingsRow } from "../components/FolioSettingsRow";
import { useThemeStore, type ThemeSetting } from "../theme/theme";
import { getLibraryFs, getLibraryManager, LIBRARY_ROOT } from "../store/libraryUi";
import { DEFAULT_READING_PREFS, READER_THEME_COLORS } from "../model/defaults";
import type { ReadingPrefs } from "../model/types";
import { strToU8, zipSync, unzipSync } from "fflate";

const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const READING_THEMES: { value: ReadingPrefs["theme"]; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "warm", label: "Paper" },
  { value: "dark", label: "Dark" },
  { value: "true-black", label: "True black" },
  { value: "system", label: "System" },
];

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadPrefs = useCallback(async () => {
    try {
      const lm = getLibraryManager();
      setDefaultPrefs(await lm.prefs.global());
    } catch {
      /* ignore */
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
    } catch {
      setStorageInfo(null);
    }
  }, []);

  useEffect(() => {
    void loadPrefs();
    void loadStorage();
  }, [loadPrefs, loadStorage]);

  const setDefaultTheme = async (theme: ReadingPrefs["theme"]) => {
    const lm = getLibraryManager();
    const next = { ...defaultPrefs, theme };
    await lm.prefs.writeGlobal(next);
    setDefaultPrefs(next);
  };

  const handleExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const fs = getLibraryFs();
      const files: Record<string, Uint8Array> = {};
      const walk = async (dir: string, prefix: string) => {
        const entries = await fs.list(dir);
        for (const e of entries) {
          const rel = prefix ? `${prefix}/${e.path.split("/").pop()}` : e.path.slice(LIBRARY_ROOT.length + 1);
          if (e.isDir) await walk(e.path, rel);
          else files[rel] = await fs.readBytes(e.path);
        }
      };
      await walk(LIBRARY_ROOT, "");
      // backup.json with manifest sha
      let manifestSha = "";
      try {
        const manifestBytes = files["manifest.json"];
        if (manifestBytes) {
          const { sha256Hex } = await import("../lib/sha256");
          manifestSha = await sha256Hex(manifestBytes);
        }
      } catch {
        /* ignore */
      }
      const backupMeta = { schema: 1, app: "folio", createdAt: new Date().toISOString(), manifestSha256: manifestSha };
      files["backup.json"] = strToU8(JSON.stringify(backupMeta));
      const zipped = zipSync(files);
      if (isTauri()) {
        const path = await saveDialog({
          defaultPath: "folio-backup.zip",
          filters: [{ name: "Zip", extensions: ["zip"] }],
        });
        if (!path) return;
        await invoke("fs_write_atomic", { path, data: Array.from(zipped) });
      } else {
        const url = URL.createObjectURL(new Blob([zipped as BlobPart], { type: "application/zip" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "folio-backup.zip";
        a.click();
        URL.revokeObjectURL(url);
      }
      setMessage("Backup exported.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const handlePickRestore = async () => {
    try {
      if (isTauri()) {
        const path = await openDialog({ multiple: false, filters: [{ name: "Zip", extensions: ["zip"] }] });
        if (!path || Array.isArray(path)) return;
        const bytes = await invoke<number[]>("fs_read", { path });
        setRestoreFile(new Uint8Array(bytes));
        setRestoreOpen(true);
      } else {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".zip";
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return;
          setRestoreFile(new Uint8Array(await f.arrayBuffer()));
          setRestoreOpen(true);
        };
        input.click();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Pick failed");
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    setBusy(true);
    setMessage(null);
    try {
      const fs = getLibraryFs();
      const unzipped = unzipSync(restoreFile);
      const entries = Object.entries(unzipped);
      if (restoreMode === "replace") {
        // Replace: clear library root then write all.
        try {
          await fs.delete(LIBRARY_ROOT);
        } catch {
          /* ignore */
        }
      }
      for (const [rel, bytes] of entries) {
        const path = `${LIBRARY_ROOT}/${rel}`;
        // merge: skip existing files
        if (restoreMode === "merge") {
          const exists = await fs.exists(path);
          if (exists) continue;
        }
        await fs.writeBytesAtomic(path, bytes);
      }
      setRestoreOpen(false);
      setRestoreFile(null);
      setMessage(`Restored ${entries.length} files (${restoreMode}).`);
      await loadStorage();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
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
          helper="Light, dark, or follow Windows"
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
          title="Default reading theme"
          helper="Changes made inside a book stay with that book."
          control={
            <div role="group" aria-label="Default reading theme" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {READING_THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`folio-theme-swatch${defaultPrefs.theme === t.value ? " is-selected" : ""}`}
                  style={{ width: 72, padding: 4 }}
                  onClick={() => void setDefaultTheme(t.value)}
                >
                  <span
                    className="folio-theme-swatch__page"
                    style={{
                      background: READER_THEME_COLORS[t.value].bg,
                      color: READER_THEME_COLORS[t.value].text,
                      height: 32,
                    }}
                  >
                    Aa
                  </span>
                  <span className="folio-theme-swatch__label">{t.label}</span>
                </button>
              ))}
            </div>
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
            <FolioButton variant="secondary" onClick={() => void handlePickRestore()} disabled={busy}>
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
          helper={LIBRARY_ROOT}
          control={
            <FolioButton
              variant="secondary"
              onClick={() => {
                if (isTauri()) void invoke("open_external_url", { url: `file://${LIBRARY_ROOT}` });
              }}
            >
              Open
            </FolioButton>
          }
        />

        <FolioSectionHeader>Cloud sync</FolioSectionHeader>
        <FolioSettingsRow
          title="Cloud sync"
          helper="Sign in and sync arrives in Phase 9"
        />

        <FolioSectionHeader>About</FolioSectionHeader>
        <FolioSettingsRow
          title="Version"
          helper="0.1.0"
        />
        <FolioSettingsRow
          title="Dictionary attribution"
          helper="Folio Dictionary (English→Hindi) — FreeDict, GPL-2.0 (Phase 10)"
        />
      </div>

      <FolioDialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title="Restore backup"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setRestoreOpen(false)}>
              Cancel
            </FolioButton>
            <FolioButton variant="primary" onClick={() => void handleRestore()} disabled={busy}>
              Restore
            </FolioButton>
          </>
        }
      >
        <div role="group" aria-label="Restore mode" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <FolioChip selected={restoreMode === "merge"} onClick={() => setRestoreMode("merge")}>
            Merge
          </FolioChip>
          <FolioChip selected={restoreMode === "replace"} onClick={() => setRestoreMode("replace")}>
            Replace
          </FolioChip>
        </div>
        <p className="folio-helper">
          {restoreMode === "merge"
            ? "Keeps existing files; only missing ones are added."
            : "Replaces the entire library with the backup contents."}
        </p>
      </FolioDialog>
    </>
  );
}
