import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The dictionary was removed entirely on 2026-10-31 (frontend meaning card,
 * lookup bridge, SQLite pack bridge, commands, resource bundling and the
 * rusqlite dependency — see D-20261031-05). This test keeps it removed: any
 * of the markers below reappearing anywhere in app source is a failure.
 */
const FORBIDDEN = [
  "MeaningCard",
  "onMeaning",
  "dict_lookup",
  "dict_status",
  "dict_sqlite_query",
  "lookupMeaning",
  "DICT_ATTRIBUTION",
  "rusqlite",
  "folio-meaning",
  "Folio Dictionary",
  "FreeDict",
];

/** The built at directory must not contain the fully retired strings either. */
const FORBIDDEN_IN_STRUCTURE = ["meaning", "dict.rs"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "target" || name === "dist") continue;
      walk(full, out);
    } else if (
      /\.(ts|tsx|rs|css|json|toml|md)$/.test(name) &&
      // The lockfile is generated; it is covered by the absence of rusqlite,
      // which we assert directly below through Cargo.toml only.
      name !== "Cargo.lock"
    ) {
      out.push(full);
    }
  }
  return out;
}

const desktopRoot = join(__dirname, "..");
const sourceFiles = walk(join(desktopRoot, "src"))
  .concat(walk(join(desktopRoot, "src-tauri", "src")))
  .concat([join(desktopRoot, "src-tauri", "Cargo.toml"), join(desktopRoot, "src-tauri", "tauri.conf.json")]);

describe("dictionary removal (D-20261031-05)", () => {
  it("no dictionary markers remain in app source", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const text = readFileSync(file, "utf8");
      for (const marker of FORBIDDEN) {
        if (text.includes(marker)) offenders.push(`${file}: ${marker}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no dictionary module directory remains in the structure", () => {
    const exists = (p: string) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    };
    const offenders = [
      join(desktopRoot, "src", "dict"),
      join(desktopRoot, "src-tauri", "dict"),
    ].filter((p) => exists(p));
    // Example src-tauri/src/<meaning-named> modules would also be regressions;
    // list any command file still named dict.rs directly.
    try {
      const cmds = readdirSync(join(desktopRoot, "src-tauri", "src", "commands"));
      for (const f of cmds) {
        if (FORBIDDEN_IN_STRUCTURE.some((m) => f.toLowerCase().includes(m)))
          offenders.push(join("src-tauri", "src", "commands", f));
      }
    } catch {
      /* commands dir missing would be a different failure */
    }
    expect(offenders).toEqual([]);
  });
});
