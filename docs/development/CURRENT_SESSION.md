# Current Session Checkpoint

**Session:** `S-20261030-02` — reader locator correctness (FT-008)
**Updated:** 2026-10-30
**Status:** FT-008 code complete and Linux-verified; FT-007 + FT-008 changes
are **uncommitted** and not pushed

## Verified current state

- Branch `main`, ahead of `origin/main` by 3 local commits (knowledge base only).
  Working tree has uncommitted changes for **two features**:
  - FT-007 backup hardening: `desktop/src/backup/` (new),
    `desktop/tests/backup.test.ts` (new), `desktop/src/lib/fileStore.ts`,
    `desktop/src/screens/SettingsScreen.tsx`, `desktop/src/shell/Shell.tsx`,
    `desktop/src-tauri/src/commands/fs.rs`.
  - FT-008 reader correctness: `desktop/src/reader/locatorCodec.ts` (new),
    `desktop/tests/locatorCodec.test.ts` (new), `desktop/src/reader/resume.ts`,
    `desktop/src/reader/readiumEngine.ts`, `desktop/src/reader/chrome.ts`,
    `desktop/src/screens/ReaderScreen.tsx`, `desktop/tests/reader.test.ts`.
- Session recovery used the dumped `session.json` of the *previous* failed
  build session (same repo) to reconstruct its FT-008 intent; see
  [`sessions/S-20261030-02-reader-locator-correctness.md`](sessions/S-20261030-02-reader-locator-correctness.md).
  `session.json` is a transcript dump, not code — it may be deleted once this
  record is trusted.
- Linux verification from `desktop/` (2026-10-30):
  - `./node_modules/.bin/tsc -b` — clean
  - `./node_modules/.bin/vitest run` — **143 tests / 13 files** passing
  - `./node_modules/.bin/vite build` — success (existing >500 kB chunk warning)
  - `cd src-tauri && cargo fmt --all -- --check` — clean
- `cargo test`, `pnpm tauri:dev` and all Windows behaviours were **not** run
  (no `webkit2gtk`/`gtk3` here). Do not describe them as verified.

## Completed in this session

1. Verified the interrupted FT-008 work left in the tree (it was sound).
2. Closed the remaining FT-008 items:
   - Click passthrough: `intentForReaderClick` in `chrome.ts` returns
     `passthrough` for interactive/default-prevented clicks; the reader screen
     forwards them to the engine instead of page-turning.
   - Reader teardown always unsubscribes engine listeners; `handleBack` no
     longer destroys the engine (the idempotent effect cleanup owns that), so
     callbacks no longer leak across reader sessions.
   - Prefs effect keys on `doc?.docId`, so progress persists no longer trigger
     redundant `applyPrefs` → navigator relayout.
3. Records written: [`I-20261030-02`](plans/implementations/I-20261030-02-reader-locator-correctness.md),
   [`S-20261030-02`](sessions/S-20261030-02-reader-locator-correctness.md);
   `TASKS.md`, session and implementation indexes updated.

## Open work

See [`TASKS.md`](TASKS.md). Both FT-007 and FT-008 need **Windows
verification** (real Tauri/webview run) that this host cannot provide. The next
unblocked P1 is **FT-001** (taskbar jump list). Committing/pushing requires
explicit user authorization.

## Exact next action

1. Ask the user whether to commit the FT-007 + FT-008 work (scoped commits,
   e.g. `feat(backup): staged restore + v2 archives` and
   `fix(reader): persisted href+progression+anchor locators`) and whether to
   push. Do not commit without approval.
2. If continuing code work without a Windows host, start **FT-001** after
   reading `.docs/09` §3 and re-checking `desktop/src-tauri/src/` for existing
   shell-integration scaffolding.
3. When a Windows host becomes available: run `cargo test --all-targets`,
   `pnpm tauri:dev`, and exercise backup replace/rollback + reader click
   zones/resume; record results under `audits/results/`.

## Recovery note

Trust this checkpoint only after re-running `git status --short --branch` and
the Linux-safe checks above. If the tree differs, treat the difference as user
work and reconcile before continuing.
