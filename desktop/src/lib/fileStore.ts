import { invoke } from "@tauri-apps/api/core";
import { globalMutex } from "./mutex";

export interface Entry {
  path: string;
  isDir: boolean;
}
export interface Stat {
  size: number;
  mtimeMs: number;
  isDir: boolean;
}

export interface FileStore {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeTextAtomic(path: string, data: string): Promise<void>;
  writeBytesAtomic(path: string, data: Uint8Array): Promise<void>;
  /** Rename a file or directory tree (same volume). */
  move(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(dir: string): Promise<Entry[]>;
  stat(path: string): Promise<Stat | null>;
  exists(path: string): Promise<boolean>;
  freeSpace(): Promise<number>;
}

// ---- in-memory backend (tests + fallback) ----

interface MemNode {
  data: Uint8Array;
  isDir: boolean;
  mtimeMs: number;
}

export class MemoryFileStore implements FileStore {
  private nodes = new Map<string, MemNode>();

  private norm(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  }


  async readText(path: string): Promise<string> {
    return globalMutex.run(path, async () => {
      const n = this.norm(path);
      const node = this.nodes.get(n);
      if (!node || node.isDir) throw new Error(`ENOENT: ${path}`);
      return new TextDecoder().decode(node.data);
    });
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return globalMutex.run(path, async () => {
      const n = this.norm(path);
      const node = this.nodes.get(n);
      if (!node || node.isDir) throw new Error(`ENOENT: ${path}`);
      return new Uint8Array(node.data);
    });
  }

  async writeTextAtomic(path: string, data: string): Promise<void> {
    const bytes = new TextEncoder().encode(data);
    await this.writeBytesAtomic(path, bytes);
  }

  async writeBytesAtomic(path: string, data: Uint8Array): Promise<void> {
    await globalMutex.run(path, async () => {
      const n = this.norm(path);
      // atomic: write to tmp then rename over target
      const tmp = n + ".tmp";
      this.nodes.set(tmp, { data: new Uint8Array(data), isDir: false, mtimeMs: Date.now() });
      // rename
      // atomic rename overwrites target; nothing else needed
      this.nodes.set(n, { data: new Uint8Array(data), isDir: false, mtimeMs: Date.now() });
      this.nodes.delete(tmp);
    });
  }

  async move(from: string, to: string): Promise<void> {
    await globalMutex.run(`${from}->${to}`, async () => {
      const a = this.norm(from);
      const b = this.norm(to);
      if (a === b) return;
      const moved: [string, MemNode][] = [];
      for (const [k, v] of this.nodes) {
        if (k === a || k.startsWith(a + "/")) moved.push([k, v]);
      }
      if (moved.length === 0) throw new Error(`ENOENT: ${from}`);
      for (const [k] of moved) this.nodes.delete(k);
      for (const [k, v] of moved) {
        this.nodes.set(b + k.slice(a.length), v);
      }
      const parent = b.split("/").slice(0, -1).join("/");
      if (parent) this.mkdirp(parent);
    });
  }

  async delete(path: string): Promise<void> {
    await globalMutex.run(path, async () => {
      const n = this.norm(path);
      // idempotent
      this.nodes.delete(n);
      // also remove children if dir
      for (const k of [...this.nodes.keys()]) {
        if (k === n || k.startsWith(n + "/")) this.nodes.delete(k);
      }
    });
  }

  async list(dir: string): Promise<Entry[]> {
    return globalMutex.run(dir, async () => {
      const n = this.norm(dir);
      const prefix = n === "/" ? "/" : n + "/";
      const out: Entry[] = [];
      const seen = new Set<string>();
      for (const [k] of this.nodes) {
        if (k === n) continue;
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const seg = rest.split("/")[0];
        const childPath = prefix + seg;
        if (seen.has(childPath)) continue;
        seen.add(childPath);
        const child = this.nodes.get(childPath);
        out.push({ path: childPath, isDir: child ? child.isDir : true });
      }
      return out;
    });
  }

  async stat(path: string): Promise<Stat | null> {
    return globalMutex.run(path, async () => {
      const n = this.norm(path);
      const node = this.nodes.get(n);
      if (!node) return null;
      return { size: node.data.length, mtimeMs: node.mtimeMs, isDir: node.isDir };
    });
  }

  async exists(path: string): Promise<boolean> {
    const s = await this.stat(path);
    return s !== null;
  }

  async freeSpace(): Promise<number> {
    return Number.MAX_SAFE_INTEGER;
  }

  // helper for tests to seed directories
  mkdirp(path: string): void {
    const n = this.norm(path);
    const parts = n.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur += "/" + p;
      if (!this.nodes.has(cur)) {
        this.nodes.set(cur, { data: new Uint8Array(), isDir: true, mtimeMs: Date.now() });
      }
    }
  }
}

// ---- Tauri-backed implementation ----

export class TauriFileStore implements FileStore {
  async readText(path: string): Promise<string> {
    const bytes = await this.readBytes(path);
    return new TextDecoder().decode(bytes);
  }
  async readBytes(path: string): Promise<Uint8Array> {
    return globalMutex.run(path, async () => {
      const arr = await invoke<number[]>("fs_read", { path });
      return new Uint8Array(arr);
    });
  }
  async writeTextAtomic(path: string, data: string): Promise<void> {
    await this.writeBytesAtomic(path, new TextEncoder().encode(data));
  }
  async writeBytesAtomic(path: string, data: Uint8Array): Promise<void> {
    await globalMutex.run(path, async () => {
      await invoke("fs_write_atomic", { path, data: Array.from(data) });
    });
  }
  async move(from: string, to: string): Promise<void> {
    await globalMutex.run(`${from}->${to}`, async () => {
      await invoke("fs_move", { from, to });
    });
  }
  async delete(path: string): Promise<void> {
    await globalMutex.run(path, async () => {
      await invoke("fs_delete", { path });
    });
  }
  async list(dir: string): Promise<Entry[]> {
    return globalMutex.run(dir, async () => {
      return invoke<Entry[]>("fs_list_dir", { dir });
    });
  }
  async stat(path: string): Promise<Stat | null> {
    return globalMutex.run(path, async () => {
      return invoke<Stat | null>("fs_stat", { path });
    });
  }
  async exists(path: string): Promise<boolean> {
    const s = await this.stat(path);
    return s !== null;
  }
  async freeSpace(): Promise<number> {
    try {
      return await invoke<number>("fs_free_space", { path: "/folio-library" });
    } catch {
      // Browser dev or a platform without the command.
      return 0;
    }
  }
}
