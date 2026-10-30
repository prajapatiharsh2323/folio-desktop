# I-20261030-01 — Backup restore hardening

**Date:** 2026-10-30
**Task:** FT-007
**Decision:** [D-20261030-01](../../decisions/D-20261030-01-backup-restore-transaction.md)
**Status:** done (Linux verification green; Windows/Tauri behaviour unverified)

## Scope

Replace the "unzip into the library" restore path with a validated, staged,
rollback-capable transaction, and give export a self-describing v2 archive.

## Files touched

| File | Change |
|---|---|
| `desktop/src/lib/fileStore.ts` | `move(from, to)` on the interface, `MemoryFileStore`, `TauriFileStore` (`fs_move`) |
| `desktop/src/backup/backupSchema.ts` | **new** — v1/v2 metadata parsing, `BackupError` codes, `BACKUP_LIMITS` |
| `desktop/src/backup/backupPaths.ts` | **new** — path normalization, classification, duplicate detection |
| `desktop/src/backup/zipArchive.ts` | **new** — central-directory reader, ZIP64/encryption rejection, per-entry inflate |
| `desktop/src/backup/reindex.ts` | **new** — rebuild `index/text/*.json` from `reading/book.epub` |
| `desktop/src/backup/backupService.ts` | **new** — `createBackup`, `inspectBackup`, `restoreBackup`, `recoverInterruptedRestore` |
| `desktop/src/screens/SettingsScreen.tsx` | summary + mode + confirmation + phase + error UI; export via `createBackup` |
| `desktop/src/shell/Shell.tsx` | startup `recoverInterruptedRestore` before the shelf renders |
| `desktop/src-tauri/src/commands/fs.rs` | `fs_delete` returns real I/O errors; `fs_move` uses `rename_with_retry`; new non-empty-dir delete test |
| `desktop/tests/backup.test.ts` | **new** — 20 tests |

## Behaviour

- **Export:** walks the library, skips `index/`, `backup.json`, `*.tmp`, OS junk;
  refuses to export when `manifest.json` is missing or unparseable; writes v2
  metadata with `manifestSha256`, doc count, file count and expanded size.
- **Preflight (`inspectBackup`):** ZIP directory → limits → path policy →
  duplicates → `backup.json` → `manifest.json` + checksum → v2 count/size
  consistency. No writes.
- **Replace:** free-space check → extract to `restore-<uuid>` → validate every
  manifest-referenced file (presence, size, SHA-256), every `meta.json`, the
  reading edition and all user JSON → two-rename swap with rollback → reindex.
- **Merge:** read both sides' user data first (a corrupt local file aborts before
  mutation), add only genuinely new docs via `LibraryManager.addDoc`, merge
  annotations/progress/collections/per-doc prefs, union collection membership
  onto `meta.json`, manifest last, reindex new docs plus existing docs with a
  missing index.
- **Recovery:** restores the newest rollback when the root is missing or its
  manifest will not parse (quarantining the unusable tree as
  `library.corrupt-<ts>`), and removes abandoned staging trees.

## Verification

Run on this Linux host, `desktop/` working directory:

```
./node_modules/.bin/tsc -b                 # clean
./node_modules/.bin/vitest run             # 127 tests / 12 files passing
./node_modules/.bin/vite build             # success (existing >500 kB chunk warning)
cd src-tauri && cargo fmt --all -- --check # clean
```

`cargo test` and `pnpm tauri:build` were **not** run: this host lacks
`webkit2gtk`/`gtk3`, so the Tauri crate cannot compile here. The Rust changes
(`fs_delete` error propagation, `rename_with_retry`, the new directory-delete
test) therefore remain unverified until CI on `windows-latest`.

## Test coverage (`desktop/tests/backup.test.ts`)

Export shape + checksum; index/backup.json exclusion; missing-manifest refusal;
non-ZIP; path traversal; case-only duplicates; manifest checksum mismatch;
doc-count mismatch; future schema; entry/total limits; legacy schema-1 read;
replace into an empty library (docs, annotations, progress, per-doc prefs,
collections, index text, no `backup.json`); swap failure keeps the old library;
damaged archive leaves the library untouched; merge adds only new docs and
unions user data with newest-wins; conflicting edition is reported, not
overwritten; startup recovery for missing root, corrupt root and stale rollback.

## Follow-ups

- Verify the swap/rollback and rename-retry behaviour on Windows (real NTFS,
  antivirus locks, app killed between renames).
- Export/restore of a multi-gigabyte library is memory-bound in the webview; a
  streaming writer (Rust `zip_write` already exists) is a performance follow-up.
- `recoverInterruptedRestore` quarantine folders are not surfaced in the UI.
