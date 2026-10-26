import { describe, it, expect } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";

describe("FileStore atomicity", () => {
  it("tmp file is cleaned up after write", async () => {
    const fs = new MemoryFileStore();
    fs.mkdirp("/tmp");
    await fs.writeTextAtomic("/tmp/a.txt", "hello");
    expect(await fs.exists("/tmp/a.txt.tmp")).toBe(false);
    expect(await fs.exists("/tmp/a.txt")).toBe(true);
  });

  it("concurrent writes to same path are serialized", async () => {
    const fs = new MemoryFileStore();
    fs.mkdirp("/tmp");
    const p = "/tmp/conc.txt";
    await Promise.all([
      fs.writeTextAtomic(p, "first"),
      fs.writeTextAtomic(p, "second"),
    ]);
    const val = await fs.readText(p);
    expect(val === "first" || val === "second").toBe(true);
  });

  it("write then read round-trips exact content", async () => {
    const fs = new MemoryFileStore();
    fs.mkdirp("/tmp");
    const payload = "line1\nline2\nspecial: \u00e9";
    await fs.writeTextAtomic("/tmp/rt.txt", payload);
    expect(await fs.readText("/tmp/rt.txt")).toBe(payload);
  });
});