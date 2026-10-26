import { describe, it, expect } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";

describe("FileStore round-trip", () => {
  it("writes and reads text", async () => {
    const fs = new MemoryFileStore();
    fs.mkdirp("/tmp");
    await fs.writeTextAtomic("/tmp/a.txt", "hello");
    expect(await fs.readText("/tmp/a.txt")).toBe("hello");
  });

  it("writes and reads bytes", async () => {
    const fs = new MemoryFileStore();
    fs.mkdirp("/tmp");
    const data = new Uint8Array([1, 2, 3, 4]);
    await fs.writeBytesAtomic("/tmp/b.bin", data);
    const out = await fs.readBytes("/tmp/b.bin");
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });

  it("delete is idempotent", async () => {
    const fs = new MemoryFileStore();
    fs.mkdirp("/tmp");
    await fs.writeTextAtomic("/tmp/c.txt", "x");
    await fs.delete("/tmp/c.txt");
    await fs.delete("/tmp/c.txt");
    expect(await fs.exists("/tmp/c.txt")).toBe(false);
  });

  it("stat returns null for missing", async () => {
    const fs = new MemoryFileStore();
    expect(await fs.stat("/nope")).toBeNull();
  });

  it("list returns children", async () => {
    const fs = new MemoryFileStore();
    fs.mkdirp("/d");
    await fs.writeTextAtomic("/d/a.txt", "a");
    await fs.writeTextAtomic("/d/b.txt", "b");
    const entries = await fs.list("/d");
    const names = entries.map((e) => e.path).sort();
    expect(names).toEqual(["/d/a.txt", "/d/b.txt"]);
  });

  it("exists works", async () => {
    const fs = new MemoryFileStore();
    fs.mkdirp("/tmp");
    await fs.writeTextAtomic("/tmp/x.txt", "x");
    expect(await fs.exists("/tmp/x.txt")).toBe(true);
    expect(await fs.exists("/tmp/missing.txt")).toBe(false);
  });
});