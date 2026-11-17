// File acquisition adapter: native dialog + drag-and-drop in Tauri,
// <input type=file> + HTML5 dnd fallback in browser (dev) mode.
//
// Security note (P0-5): every path a file command accepts must be inside the
// app dir or granted this session. Native pickers run in Rust
// (`pick_*` commands) so the grant is made where the user picks; OS drops are
// granted in the DragDrop handler, which then emits `folio://drop-granted` —
// the webview never receives a usable path before the grant exists.
import { invoke } from "@tauri-apps/api/core";

export interface PickedFile {
  name: string;
  /** Declared size in bytes when known up front (stat/File.size), else null. */
  size: number | null;
  /**
   * Step 3.2: bytes are read lazily, one file at a time, right before that
   * file is imported — a multi-file pick no longer holds every book in memory.
   */
  read: () => Promise<Uint8Array>;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Import filters live in the Rust `pick_import_files` command so the grant and
// the dialog stay together.

export const DROP_GRANTED_EVENT = "folio://drop-granted";

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** Open the native file dialog (Tauri) or a file input (browser) and read bytes. */
export async function pickImportFiles(): Promise<PickedFile[]> {
  if (isTauri()) {
    const paths = await invoke<string[]>("pick_import_files");
    const out: PickedFile[] = [];
    for (const p of paths) {
      // Stat up front so an oversized pick is refused before its bytes are
      // ever read; the bytes themselves stay lazy (one file at a time).
      const stat = await invoke<{ size: number } | null>("fs_stat", { path: p });
      out.push(lazyPickedFile(p, stat?.size ?? null));
    }
    return out;
  }
  // browser dev fallback
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".epub,.html,.htm,.txt,.md,.pdf";
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      const out: PickedFile[] = [];
      for (const f of files)
        out.push({
          name: f.name,
          size: f.size,
          read: async () => new Uint8Array(await f.arrayBuffer()),
        });
      resolve(out);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** One granted path → a lazily-read file (E1: raw IPC body, ArrayBuffer). */
function lazyPickedFile(path: string, size: number | null): PickedFile {
  return {
    name: baseName(path),
    size,
    read: async () => {
      const buf = await invoke<ArrayBuffer>("fs_read", { path });
      return new Uint8Array(buf);
    },
  };
}

/**
 * F7: native folder picker for bulk import. Returns the picked folder path
 * (granted this session by the Rust picker) or null on cancel; the recursive
 * enumeration lives in `folderImport.ts`. Browser dev mode has no folder
 * picker — returns null so callers show a no-op message.
 */
export async function pickImportFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  return await invoke<string | null>("pick_import_folder");
}

/** Native save dialog for the backup archive. Returns null when cancelled. */
export async function pickBackupDestPath(defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;
  return await invoke<string | null>("pick_backup_dest", { defaultName });
}

/** Native open dialog for a backup to restore. Returns null when cancelled. */
export async function pickBackupSourcePath(): Promise<string | null> {
  if (!isTauri()) return null;
  return await invoke<string | null>("pick_backup_source");
}

/** Native save dialog for the quote-card PNG. Returns null when cancelled. */
export async function pickImageDestPath(defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;
  return await invoke<string | null>("pick_image_dest", { defaultName });
}

/** Native save dialog for a text export (Markdown/CSV). N1. */
export async function pickExportDestPath(defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;
  return await invoke<string | null>("pick_export_dest", { defaultName });
}

/** HTML5 drop → lazily-read files (browser mode). */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const f of Array.from(dt.files)) {
    out.push({
      name: f.name,
      size: f.size,
      read: async () => new Uint8Array(await f.arrayBuffer()),
    });
  }
  return out;
}

/** Granted drop/launch paths → lazily-read files. Null when not in Tauri. */
export async function filesFromTauriDrop(paths: string[]): Promise<PickedFile[] | null> {
  if (!isTauri()) return null;
  const out: PickedFile[] = [];
  for (const p of paths) {
    const stat = await invoke<{ size: number } | null>("fs_stat", { path: p });
    out.push(lazyPickedFile(p, stat?.size ?? null));
  }
  return out;
}

/**
 * Subscribe to OS drops in Tauri. Rust grants the dropped paths *before*
 * emitting this event, so every path the handler sees is already readable.
 * Returns an unsubscribe function.
 */
export async function onDroppedFiles(handler: (files: PickedFile[]) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<string[]>(DROP_GRANTED_EVENT, (event) => {
      const paths = Array.isArray(event.payload) ? event.payload : [];
      if (paths.length === 0) return;
      void filesFromTauriDrop(paths).then((files) => {
        if (files && files.length > 0) handler(files);
      });
    });
  } catch {
    return () => {};
  }
}
