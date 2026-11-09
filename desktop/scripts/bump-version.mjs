#!/usr/bin/env node
// Set the Folio version in every place that carries it, so a release cannot
// ship a Settings row, installer and backup tag that disagree.
//
// Usage: node scripts/bump-version.mjs 0.2.0
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dirname(desktop);

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

const version = process.argv[2];
if (!version || !SEMVER.test(version)) {
  console.error("usage: node scripts/bump-version.mjs <version>  (e.g. 0.2.0)");
  process.exit(1);
}

function rewrite(path, pattern, replacement) {
  const abs = join(desktop, path);
  const before = readFileSync(abs, "utf8");
  if (!pattern.test(before)) {
    throw new Error(`${path}: version pattern not found; update the bump script`);
  }
  const after = before.replace(pattern, replacement);
  // Re-running with the current version is a no-op, not an error.
  if (after !== before) writeFileSync(abs, after);
  return path;
}

const changed = [
  // package.json owns the value Vite injects as __APP_VERSION__.
  rewrite("package.json", /("version":\s*")[^"]+(")/, `$1${version}$2`),
  // Tauri uses this for the installer and the window's reported version.
  rewrite(
    "src-tauri/tauri.conf.json",
    /("version":\s*")[^"]+(")/,
    `$1${version}$2`
  ),
  // Rust crate version (Cargo + the single lock entry for this package).
  rewrite(
    "src-tauri/Cargo.toml",
    /(\[package\][\s\S]*?\r?\nversion\s*=\s*")[^"]+(")/,
    `$1${version}$2`
  ),
  rewrite(
    "src-tauri/Cargo.lock",
    /(\[\[package\]\]\r?\nname = "folio-desktop"\r?\nversion = ")[^"]+(")/,
    `$1${version}$2`
  ),
  // Backup archives tag their writer version; tests pin this to package.json.
  rewrite(
    "src/backup/backupSchema.ts",
    /(export const APP_VERSION = ")[^"]+(")/,
    `$1${version}$2`
  ),
];

console.log(`Folio ${version}`);
for (const file of changed) console.log(`  updated ${join("desktop", file)}`);
console.log(`\nNext: update CHANGELOG.md, then rebuild (${join("desktop", "pnpm tauri:build")}).`);
console.log(`Repo root: ${root}`);
