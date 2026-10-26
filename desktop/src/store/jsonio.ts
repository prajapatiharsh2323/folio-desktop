// JSON read/write with unknown-key preservation (05 §3 "ignoreUnknownKeys":
// never delete unknown fields when rewriting).
import type { FileStore } from "../lib/fileStore";

export async function readJsonAsync<T = unknown>(
  fs: FileStore,
  path: string
): Promise<T | null> {
  if (!(await fs.exists(path))) return null;
  const text = await fs.readText(path);
  try {
    return JSON.parse(text) as T;
  } catch {
    return null; // unreadable → treated as missing (recovery paths handle manifests)
  }
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

export async function writeJsonAtomic(
  fs: FileStore,
  path: string,
  value: unknown
): Promise<void> {
  await fs.writeTextAtomic(path, serializeJson(value));
}
