// File acquisition adapter: native dialog + drag-and-drop in Tauri,
// <input type=file> + HTML5 dnd fallback in browser (dev) mode.
import { invoke } from "@tauri-apps/api/core";

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const IMPORT_FILTER = [
  { name: "Books & articles", extensions: ["epub", "html", "htm", "txt", "md"] },
];

/** Open the native file dialog (Tauri) or a file input (browser) and read bytes. */
export async function pickImportFiles(): Promise<PickedFile[]> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selection = await open({
      multiple: true,
      filters: IMPORT_FILTER,
      title: "Import files",
    });
    if (!selection) return [];
    const paths = Array.isArray(selection) ? selection : [selection];
    const out: PickedFile[] = [];
    for (const p of paths) {
      const arr = await invoke<number[]>("fs_read", { path: p });
      out.push({ name: p.split(/[\\/]/).pop() ?? p, bytes: new Uint8Array(arr) });
    }
    return out;
  }
  // browser dev fallback
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".epub,.html,.htm,.txt,.md";
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      const out: PickedFile[] = [];
      for (const f of files) out.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      resolve(out);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** HTML5 drop → bytes (browser mode). */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const f of Array.from(dt.files)) {
    out.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  return out;
}

/** Tauri drag-drop paths → bytes. Returns null when not in Tauri. */
export async function filesFromTauriDrop(paths: string[]): Promise<PickedFile[] | null> {
  if (!isTauri()) return null;
  const out: PickedFile[] = [];
  for (const p of paths) {
    const arr = await invoke<number[]>("fs_read", { path: p });
    out.push({ name: p.split(/[\\/]/).pop() ?? p, bytes: new Uint8Array(arr) });
  }
  return out;
}
