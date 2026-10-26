import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fixture from "./fixtures/tokens.json";

const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

/** Parse `--name: value;` pairs out of a CSS block introduced by `selector {`. */
function parseBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`block not found: ${selector}`);
  // find matching close brace
  let depth = 0;
  let i = css.indexOf("{", start);
  const open = i;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = css.slice(open + 1, i);
  const map: Record<string, string> = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    map[m[1]] = m[2].trim();
  }
  return map;
}

describe("design tokens", () => {
  it("root block matches the checked-in light fixture exactly", () => {
    const root = parseBlock(":root");
    const expected = fixture.light as Record<string, string>;
    expect(Object.keys(root).sort()).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) {
      expect(root[k], k).toBe(v);
    }
  });

  it("dark block matches the checked-in dark fixture exactly", () => {
    const dark = parseBlock('[data-theme="dark"]');
    const expected = fixture.dark as Record<string, string>;
    expect(Object.keys(dark).sort()).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) {
      expect(dark[k], k).toBe(v);
    }
  });

  it("dark overrides never include on-accent from light (it stays valid)", () => {
    const dark = parseBlock('[data-theme="dark"]');
    expect(dark["--folio-accent"]).not.toBe(fixture.light["--folio-accent"]);
    // dark canvas must not be pure black (03 §2.4)
    expect(dark["--folio-canvas"]).toBe("#141713");
  });
});
