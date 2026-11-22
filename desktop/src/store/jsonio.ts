// JSON read/write with unknown-key preservation (05 §3 "ignoreUnknownKeys":
// never delete unknown fields when rewriting).
import type { FileStore } from "../lib/fileStore";
import { reportError } from "../lib/errorLog";

export async function readJsonAsync<T = unknown>(fs: FileStore, path: string): Promise<T | null> {
  if (!(await fs.exists(path))) return null;
  const text = await fs.readText(path);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    // Unreadable → treated as missing (recovery paths handle manifests), but a
    // corrupt user file must leave a diagnostic before the next write replaces
    // it — otherwise annotation data can disappear with no trace.
    reportError(error, `storage.json.parse:${path}`);
    return null;
  }
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

export async function writeJsonAtomic(fs: FileStore, path: string, value: unknown): Promise<void> {
  await fs.writeTextAtomic(path, serializeJson(value));
}
