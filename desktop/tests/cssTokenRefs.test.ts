// UI-018: every var(--folio-*) reference without a fallback must resolve to a
// token defined somewhere in the shared stylesheets. Complements tokens.test.ts,
// which pins the values of defined tokens but cannot see dangling references.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from desktop/, so resolve from the process cwd (the transformed
// import.meta.url is a virtual module path, not a real file).
const STYLES = resolve(process.cwd(), "src/styles");
const files = readdirSync(STYLES).filter((f) => f.endsWith(".css"));
const css = files.map((f) => readFileSync(join(STYLES, f), "utf8")).join("\n");

const TOKEN = /--folio-[a-z0-9-]+/g;

describe("CSS custom-property references", () => {
  it("defines every referenced token (or supplies a fallback)", () => {
    const defined = new Set(css.match(/(--folio-[a-z0-9-]+)\s*:/g)?.map((m) => m.match(TOKEN)![0]));
    const dangling = new Set<string>();
    // A var() has a fallback when the first top-level separator is a comma.
    const references = css.match(/var\(\s*(--folio-[a-z0-9-]+)\s*([,)])/g) ?? [];
    for (const ref of references) {
      const parsed = ref.match(/var\(\s*(--folio-[a-z0-9-]+)\s*([,)])/)!;
      if (parsed[2] === ")" && !defined.has(parsed[1])) dangling.add(parsed[1]);
    }
    expect([...dangling].sort()).toEqual([]);
  });

  it("keeps fallbacks on reader-only tokens that are intentionally undefined", () => {
    // Guards against someone removing a fallback while cleaning up UI-018.
    const reader = readFileSync(join(STYLES, "reader.css"), "utf8");
    for (const token of [
      "--folio-radius-md",
      "--folio-text-strong",
      "--folio-type-note-size",
      "--folio-type-small-size",
      "--folio-progress",
      "--folio-linefocus-dim",
    ]) {
      expect(reader.match(new RegExp(`var\\(\\s*${token}\\s*\\)`, "g")), token).toBeNull();
    }
  });
});
