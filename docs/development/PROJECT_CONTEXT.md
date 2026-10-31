# Project Context

Verified against the repository on **2026-10-29** at commit `242778b`
(`main`, clean). Re-verify commands and paths before relying on them.

## Repository map

| Path | Role |
|---|---|
| `desktop/` | The application (frontend + Tauri shell). **Run all app commands here.** |
| `desktop/src/` | React/TypeScript app code: screens, components, stores, reader, import, search, dictionary. (Drive sync was removed 2026-10-31.) |
| `desktop/src-tauri/` | Thin Rust core: filesystem/zip/hash commands, path guard, app-dir mapping, window state, dictionary bridge. (OAuth was removed with sync.) |
| `desktop/tests/` | Vitest suites and exact JSON fixtures. |
| `.docs/01–09` | Product, architecture, UI/UX, reader, data-model, feature, keyboard, prompt-pack, and platform specs. |
| `.github/workflows/desktop-ci.yml` | Windows-only CI. |
| `REMAINING.md` | Current open work (authoritative status list at the repo root). |
| `desktop/README.md` | Historical phase-by-phase implementation log. |
| `docs/development/` | This knowledge base. |
| `desktop/dist/`, `desktop/src-tauri/target/` | Generated outputs; ignored by Git. Do not edit. |

There is no root package manifest, no monorepo tool, no ESLint/Prettier config.
`desktop` is a single pnpm project with a `pnpm-workspace.yaml` used only for
`allowBuilds: esbuild`.

## Stack and runtimes

- **Frontend:** React 18.3, TypeScript 5.6 (strict, `noUnusedLocals`,
  `noUnusedParameters`, `noFallthroughCasesInSwitch`), Vite 5, Zustand 4.
- **Reader:** Readium web toolkit (`@readium/navigator`, `@readium/shared`).
- **Shell:** Tauri 2, Rust 2021 edition, NSIS installer for Windows.
- **Tests:** Vitest 2 with `jsdom`; no snapshot suites.
- **Data:** plain JSON files through a `FileStore` port; no app database.
  SQLite is used only for the optional dictionary pack.
- **CI:** pnpm 11, Node 22, `windows-latest`.

## Commands

Run from `desktop/` unless noted.

```bash
pnpm install                  # CI uses --frozen-lockfile
pnpm exec tsc -b              # typecheck (strict)
pnpm exec vitest run          # all unit tests
pnpm exec vitest run tests/reader.test.ts
pnpm exec vitest run tests/reader.test.ts -t "progress"
pnpm exec vite build          # frontend production build
pnpm tauri:dev                # requires a working desktop webview
pnpm tauri:build              # NSIS installer
cd src-tauri
cargo test --all-targets
cargo fmt --all -- --check
```

The CI order is: `tsc -b` → `vitest run` → `vite build` → `cargo test` →
`cargo fmt --check` → `tauri build` (artifact upload).

If `pnpm` is not installed (it is absent in this Linux VM) but `node_modules`
exists, use `./node_modules/.bin/tsc -b`, `./node_modules/.bin/vitest run`, and
`./node_modules/.bin/vite build` from `desktop/`.

## Environment constraints

- **Full builds are Windows-only.** Linux lacks `webkit2gtk`/`gtk3`. `cargo test` and
  `pnpm tauri:*` are not valid Linux verification here. Do not claim they
  passed. (The sync-only `keyring`/`reqwest` crates were removed with Drive
  sync, 2026-10-31 — see D-20261031-03.)
- Linux-safe verification: `tsc -b`, Vitest, `vite build`.
- Vite dev server uses fixed port `1420` (`strictPort`). It ignores
  `**/src-tauri/**` while watching because cargo's locked debug DLL crashed the
  watcher with `EBUSY` on Windows.
- Google Drive sync was removed (2026-10-31, D-20261031-03); the app makes no
  network requests. Do not reintroduce network hosts into the CSP.
- The dictionary pack is a release asset, not in the repo. Until it is placed in
  `desktop/src-tauri/dict/`, Settings reports “Pack not installed”.
- **COM string values must use task memory.** A `VT_LPWSTR` in a
  `PROPVARIANT` (for example `PKEY_Title` on a jump-list `IShellLink`) is
  freed by the shell with `CoTaskMemFree`. Backing it with a Rust `Vec` buffer
  corrupted the process heap and killed the app at startup
  (`0xC0000374`) — see
  [`A-BUG-20261031-01`](audits/bugs/A-BUG-20261031-01-jumplist-startup-crash.md).
  Allocate with `CoTaskMemAlloc` and release with `PropVariantClear`.

## Architecture

**Frontend owns the application model.** Screens, importers, reader behavior,
search, annotations, backup/merge logic are TypeScript. Rust is a thin,
generic OS bridge and must not parse `DocMeta`/`Manifest` or hardcode Folio
layout.

**Rust commands** (`desktop/src-tauri/src/lib.rs`):
`fs_read`, `fs_write_atomic`, `fs_delete`, `fs_move`, `fs_stat`, `fs_list_dir`,
`fs_free_space`, `sha256_file`, `zip_read`, `zip_write`, `open_external_url`,
`open_app_dir`, `library_path`, `prevent_display_sleep`, `dict_sqlite_query`,
`dict_lookup`, `dict_status`, and `take_pending_launch`. (The OAuth
sign-in/refresh/status/sign-out commands were removed with Drive sync,
2026-10-31.)

**Virtual paths.** TypeScript builds all library paths under `/folio-library`
(`desktop/src/lib/libraryPaths.ts`). Rust translates that prefix to the real app
dir in `desktop/src-tauri/src/appdir.rs`; native/UNC paths pass through. Every
Rust write goes through `guard.rs` (absolute-path + traversal checks).

**On-disk layout.** Default app dir is `%APPDATA%/Folio` (Windows); the library
root is `<appDir>/library`:

```
library/manifest.json                 # commit point
library/docs/<slug>/                  # meta.json, original/, clean/, reading/, cover
library/user/{annotations,progress,collections,settings,doc-settings}.json
library/index/text/<docId>.json       # device-local search cache
<appDir>/user/window.json             # desktop-only window geometry
```

(Sync had an `<appDir>/sync/state.json`; it is read/written by nothing since
the 2026-10-31 removal and can be deleted manually.)

**Import pipeline** (`src/import/`): format detection/refusals (PDF, DRM,
rights, 50 MB cap) → HTML sanitizer → TXT/HTML/EPUB import → deterministic
`EpubBuilder` → dedup gate (Skip / Keep both / Replace) → `LibraryManager`
commit → recovery detection for damaged docs/interrupted imports.

**Reader** (`src/reader/`): Readium navigator adapter, positions, TOC/cover
parsing, themes/typography, progress with write gates, resume cascade, pace,
chrome state, keep-awake. Reader route is `src/screens/ReaderScreen.tsx`.
(Drive sync was removed 2026-10-31 — see D-20261031-03.)

## Data-model invariants (highest risk)

Source of truth: `.docs/05-data-model-and-compat.md` and
`desktop/src/model/types.ts`.

- Schema-1 JSON field names, optionality, and enum strings are frozen for
  compatibility with the Android app.
- Unknown keys must survive read → patch → rewrite.
- `manifest.json` is written **last** after any doc mutation.
- `collections.json` `docIds` ↔ `docMeta.collectionIds` are dual-written through
  shared mutators.
- Doc deletion cascades: folder → index → annotations/progress/collections/
  doc-settings → manifest last.
- Content hash is SHA-256 hex. Slugs are lowercase-with-dashes with `-2`
  collision suffixes.
- Backup ZIP contract is defined in `.docs/05` §5; the Drive mirror contract
  (§6) is retired with the feature removal (2026-10-31, D-20261031-03).

## Testing quirks

- `tests/fixtures/*.json` are compact, byte-identical round-trip fixtures.
  Reformatting them can break the tests and the compatibility guarantee.
- `tests/tokens.test.ts` parses `src/styles/tokens.css` and compares every token
  to `tests/fixtures/tokens.json`; change both intentionally.
- `src/import` and reader tests use in-memory `MemoryFileStore`; no Tauri runtime
  is needed.
- `tests/shell.test.tsx` emits React `act(...)` warnings; they are known noise,
  not failures.
- There is no integration/E2E suite and no required external service for the
  Vitest run.
- Last verified locally: **107 tests in 11 files** passing, `tsc -b` clean,
  `vite build` successful.

## Documentation and stale references

- Read `.docs/02-architecture-and-stack.md` and `.docs/05` first, then the
  feature/reader/UI specs as needed.
- `.docs/README.md` mentions `mobile/`, `.docs/design-system.md`, `PRD.md`, and
  `docs/` that do not exist in this repository. The Android reference tree is
  not available here; `.docs/03` carries the token tables.
- `desktop/README.md` records historical phase completion; use `TASKS.md` for
  current status.
- Git: `main` tracks `origin/main`. Never commit/push/change remotes or discard
  uncommitted work without explicit authorization.
