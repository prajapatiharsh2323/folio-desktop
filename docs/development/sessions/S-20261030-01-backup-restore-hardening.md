# S-20261030-01 — Backup/restore hardening (Phase 1)

**Date:** 2026-10-30
**Previous session:** `S-20261029-01` (knowledge-base bootstrap)
**Status:** complete, verified on Linux; nothing committed or pushed

## Objective

Execute Phase 1 of the remediation audit: make ZIP backup export and restore
safe and trustworthy before touching reader, sync, search or UI work.

## What was inspected first

- `desktop/src/lib/fileStore.ts`, `desktop/src-tauri/src/commands/fs.rs` —
  no `move`, and `fs_delete` swallowed every error.
- `desktop/src/screens/SettingsScreen.tsx` — export walked the whole tree
  (including `index/`), restore `delete`d the root then wrote entries, merge
  skipped existing *paths*.
- `desktop/src/store/libraryManager.ts`, `repos.ts`, `docMetaRepo.ts` — mutators
  needed for a document-aware merge and manifest-last ordering.
- `desktop/src/model/types.ts` — schema-1 shapes to keep byte-compatible.
- `desktop/src/import/epubImporter.ts` — `parseEpub` reused for reindexing.

## Actions

1. Added `FileStore.move` (memory + Tauri), fixed `fs_delete` to surface I/O
   errors while staying idempotent, added rename retry for Windows locks.
2. Wrote `desktop/src/backup/`: schema/limits, path policy, central-directory
   ZIP reader, reindex, and the export/inspect/restore/recovery service.
3. Replaced the Settings backup UI: archive summary, merge/replace choice,
   explicit replace confirmation, phase status, `role="alert"` errors, reader
   closed and library refreshed after a restore.
4. Wired `recoverInterruptedRestore` into `Shell` startup.
5. Added `desktop/tests/backup.test.ts` (20 tests) and one Rust directory-delete
   test.

## Verification evidence

From `desktop/`:

- `./node_modules/.bin/tsc -b` — clean.
- `./node_modules/.bin/vitest run` — **127 tests / 12 files passing**
  (baseline was 107/11).
- `./node_modules/.bin/vite build` — success; pre-existing >500 kB chunk warning.
- `cd src-tauri && cargo fmt --all -- --check` — clean.

Not run: `cargo test`, `pnpm tauri:build`, any Windows webview behaviour. This
host has no `webkit2gtk`/`gtk3`.

## Decisions

- [D-20261030-01](../../decisions/D-20261030-01-backup-restore-transaction.md) —
  v2 archive metadata, validate-before-mutate, staged two-rename replace with
  rollback and startup recovery, document-aware merge, index rebuilt on restore.

## Unresolved / carried forward

- Windows verification of the swap, rollback, and rename retry.
- `cargo test` for the new `fs_delete`/`fs_move` behaviour runs only in CI.
- Multi-gigabyte export is still webview-memory-bound.
- Phase 2 (reader resume/relayout/click/tap and bookmark/decoration anchoring
  via `href + progression + text anchor`) not started; the no-CFI decision is
  recorded in the project context and will get its own decision record when the
  reader work lands.

## Exact next action

Phase 2: reader correctness. Start by re-reading
`desktop/src/reader/readiumEngine.ts` and `desktop/src/screens/ReaderScreen.tsx`,
then make locator restore use `href` + progression + text anchor, and verify
`tsc -b` + `vitest run`. Update `TASKS.md` (FT-008) to `in-progress` first.
