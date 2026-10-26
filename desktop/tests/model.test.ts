import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Annotation, DocMeta, Progress } from "../src/model/types";
import { serializeJson } from "../src/store/jsonio";

const F = (name: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures", name), "utf8"));
const RAW = (name: string) => readFileSync(resolve(process.cwd(), "tests/fixtures", name), "utf8");

// Byte-stability: parse → serialize must reproduce the fixture text exactly
// (canonical compact JSON, schema field order preserved).
describe("schema-1 byte compatibility", () => {
  it("docmeta round-trips byte-identically", () => {
    const raw = RAW("docmeta.json").trim();
    const parsed = F("docmeta.json") as DocMeta;
    expect(serializeJson(parsed)).toBe(raw);
    expect(parsed.schema).toBe(1);
  });

  it("progress round-trips byte-identically", () => {
    const raw = RAW("progress.json").trim();
    const parsed = F("progress.json") as Record<string, Progress>;
    expect(serializeJson(parsed)).toBe(raw);
    const p = Object.values(parsed)[0];
    expect(p.percent).toBe(12.3);
    expect(p.pace?.sessionsMs).toBe(1845000);
  });

  it("annotations round-trip byte-identically", () => {
    const raw = RAW("annotations.json").trim();
    const parsed = F("annotations.json") as Annotation[];
    expect(serializeJson(parsed)).toBe(raw);
    expect(parsed.map((a) => a.kind)).toEqual(["highlight", "bookmark"]);
  });

  it("collections round-trip byte-identically", () => {
    const raw = RAW("collections.json").trim();
    expect(serializeJson(F("collections.json"))).toBe(raw);
  });

  it("unknown keys survive a patch-and-rewrite (ignoreUnknownKeys)", () => {
    const doc = { ...F("docmeta.json"), futureField: { keep: true } } as unknown as DocMeta;
    // simulate the mergePreserve path used by repos
    const patched = { ...doc, title: "Moby Dick (updated)" } as unknown as DocMeta;
    const out = JSON.parse(serializeJson(patched)) as Record<string, unknown>;
    expect(out.futureField).toEqual({ keep: true });
    expect(out.title).toBe("Moby Dick (updated)");
  });

  it("enum string values are locked (05 §1)", async () => {
    const types = readFileSync(resolve(process.cwd(), "src/model/types.ts"), "utf8");
    for (const v of [
      '"article" | "book"',
      '"epub" | "pdf" | "html" | "txt" | "clip"',
      '"highlight" | "note" | "bookmark"',
      '"yellow" | "green" | "blue" | "pink"',
    ]) {
      expect(types).toContain(v);
    }
  });
});
