# AGENTS.md

Folio Desktop — a Windows-first EPUB reader built with **Tauri 2 + React 18 +
TypeScript**. The application is in `desktop/`; the repo root holds specs and
project records.

## Read before substantial work

1. [`docs/development/README.md`](docs/development/README.md) — operating rules,
   recovery procedure, knowledge-base map.
2. [`docs/development/PROJECT_CONTEXT.md`](docs/development/PROJECT_CONTEXT.md) —
   architecture, commands, invariants, environment gotchas.
3. [`docs/development/TASKS.md`](docs/development/TASKS.md) — current work.
4. [`docs/development/CURRENT_SESSION.md`](docs/development/CURRENT_SESSION.md) —
   last checkpoint and exact next action.

Then inspect `git status`, recent commits, and the actual code you will change.
Do not trust notes over the implementation.

## Commands (run from `desktop/`, not the repo root)

| Task | Command |
|---|---|
| Install | `pnpm install` (CI uses pnpm 11 / Node 22) |
| Typecheck | `pnpm exec tsc -b` |
| All tests | `pnpm exec vitest run` |
| One test file | `pnpm exec vitest run tests/reader.test.ts` |
| One named test | `pnpm exec vitest run tests/reader.test.ts -t "name"` |
| Frontend build | `pnpm exec vite build` |
| Dev app | `pnpm tauri:dev` (Windows/webview only) |
| NSIS installer | `pnpm tauri:build` |
| Rust tests | `cd src-tauri && cargo test --all-targets` |
| Rust format check | `cd src-tauri && cargo fmt --all -- --check` |

If `pnpm` is unavailable but `desktop/node_modules` exists, use
`./node_modules/.bin/tsc -b`, `./node_modules/.bin/vitest run`, and
`./node_modules/.bin/vite build` from `desktop/`.

## Build-platform limit

The full Rust/Tauri build is **Windows-first**: `keyring` uses `windows-native`,
and this Linux environment lacks `webkit2gtk`/`gtk3`. CI runs on
`windows-latest` only. Linux verification is limited to `tsc`, Vitest, and the
Vite frontend build. Never claim a Tauri/`cargo` build passed unless it actually
ran on a supported host.

## Must-not-break rules

- **Schema-1 compatibility is frozen.** Do not rename/remove fields or change
  enum strings in `desktop/src/model/types.ts`; preserve unknown keys when
  reading and rewriting JSON. See `.docs/05-data-model-and-compat.md`.
- **Manifest is the commit point.** Write doc data → `meta.json` →
  `manifest.json` **last**; use `LibraryManager` mutators (dual-write collection
  ids, cascade deletes) instead of hand-editing files.
- **Sync semantics:** newest-wins, per-id user-JSON merge, **deletions never
  propagate**, manifest uploaded last. See `desktop/src/sync/`.
- **Path ownership:** TypeScript owns all library layout
  (`desktop/src/lib/libraryPaths.ts`) under the virtual root `/folio-library`;
  Rust maps that prefix (`desktop/src-tauri/src/appdir.rs`) and must not
  hardcode Folio paths. All Rust writes go through the path guard.
- **Fixtures are exact.** `desktop/tests/fixtures/*.json` back byte-identical
  round-trip tests; don't reformat them. `tests/tokens.test.ts` pins CSS tokens
  to `fixtures/tokens.json`; update both deliberately.
- **Privacy:** no telemetry/analytics; keep the Tauri CSP restricted; only Drive
  REST traffic when sync is enabled; external URLs are http/https only.

## Project records

- Product/design source of truth: `.docs/01–09`. Read `02` and `05` first.
  `.docs/README.md` references a `mobile/` tree and `.docs/design-system.md`
  that are **not present** in this repo; don't assume they exist.
- Current status: `REMAINING.md` (open work) and `desktop/README.md`
  (historical phase log, not a task board).
- Knowledge base: `docs/development/` with stable IDs (`S-`, `I-`, `A-`, `R-`,
  `D-`, `P-`) and indexes. Update `CURRENT_SESSION.md` after milestones and
  `TASKS.md` whenever status changes.

## Git safety

`main` tracks `origin/main` (`github.com/prajapatiharsh2323/folio-desktop`).
Never commit, push, change remotes, or discard user changes without explicit
authorization. Do not describe work as pushed or backed up unless the command
succeeded. Preserve historical records; archive superseded documents instead of
overwriting them.
