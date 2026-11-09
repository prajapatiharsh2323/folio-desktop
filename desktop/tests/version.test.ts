// The version is written in five places; a release must not let them drift
// apart. Keep this in sync with desktop/scripts/bump-version.mjs.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));

function read(path: string): string {
  return readFileSync(join(desktop, path), "utf8");
}

function versionOf(path: string, pattern: RegExp): string {
  const match = pattern.exec(read(path));
  if (!match) throw new Error(`version not found in ${path}`);
  return match[1];
}

describe("release version", () => {
  const pkg = versionOf("package.json", /"version":\s*"([^"]+)"/);
  const sources: [string, string][] = [
    [
      "src-tauri/tauri.conf.json",
      versionOf("src-tauri/tauri.conf.json", /"version":\s*"([^"]+)"/),
    ],
    [
      "src-tauri/Cargo.toml",
      versionOf(
        "src-tauri/Cargo.toml",
        /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/
      ),
    ],
    [
      "src-tauri/Cargo.lock",
      versionOf(
        "src-tauri/Cargo.lock",
        /\[\[package\]\]\nname = "folio-desktop"\nversion = "([^"]+)"/
      ),
    ],
    [
      "src/backup/backupSchema.ts",
      versionOf("src/backup/backupSchema.ts", /APP_VERSION = "([^"]+)"/),
    ],
  ];

  it("is valid semver", () => {
    expect(pkg).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it.each(sources)("%s matches package.json", (_path, value) => {
    expect(value).toBe(pkg);
  });

  it("has a bump script wired to npm", () => {
    const scripts = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(scripts.scripts["bump-version"]).toBe("node scripts/bump-version.mjs");
  });
});
