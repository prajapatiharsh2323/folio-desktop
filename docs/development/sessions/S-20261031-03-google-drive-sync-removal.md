# S-20261031-03 — Google Drive sync removal

**Date:** 2026-10-31
**Decision:** [D-20261031-03](../decisions/D-20261031-03-google-drive-sync-removal.md)
**Status:** removed; Linux verification green; Rust binary checks await CI
(`cargo test`/build are Windows-only here)

## Objective

User decision: remove Google Drive sync completely while keeping the ZIP
backup. Sync was code-complete but its end-to-end path (FT-003) had been
blocked forever on an external Google OAuth credential that could never live
in the repo.

## What this session did

1. **Surfaced the full sync dependency graph** before touching anything:
   `desktop/src/sync/` (6 modules), `src-tauri/src/oauth.rs` +
   `oauth_*` handlers, Cargo `keyring`/`reqwest`/`base64`/`rand`/`url`,
   Google CSP hosts, Settings card + Shell scheduler + `.folio-sync-*` CSS +
   `libraryPaths.syncState`. Confirmed **zero imports** between
   `src/backup/` and `src/sync/` in either direction, so backup is safe.
2. **Deleted the feature** and all wiring (full list in D-20261031-03).
3. **Kept, verifiably untouched:** `desktop/src/backup/*`,
   `tests/backup.test.ts`, the Settings Backup UI, `recoverInterruptedRestore`
   in `Shell.tsx`, and the frozen schema-1 `Manifest.libraryId` (its comment
   no longer mentions the Drive mirror).
4. **Pruned `Cargo.lock`** by an offline re-resolution
   (`cargo metadata --offline`): 236 orphaned lines removed (`keyring`, `rand`,
   `foreign-types 0.3`, `hyper-tls`, …), no version bumps, no dangling
   references. `reqwest`/`base64`/`url` stay in the lock only because `tauri`
   itself depends on them.
5. **Docs:** `AGENTS.md` (platform note, privacy bullet, removed sync rule),
   `REMAINING.md` (Phase 9 marked removed, limitations updated),
   `.docs/05` §6 marked RETIRED in place (frozen contract doc, content kept),
   knowledge base (`TASKS.md` FT-003 retired, `decisions/README.md` rows
   D-006/D-007 superseded + new D-20261031-03, `PROJECT_CONTEXT.md`,
   `plans/features/README.md`, `CURRENT_SESSION.md`, this record).

## Verified (Linux, 2026-10-31)

- `tsc -b` clean.
- `vitest run`: **140 tests / 14 files** passing. The only delta vs the
  previous 149/15 is the 9 sync tests deleted with the feature; no other
  suite regressed.
- `vite build` success (chunking warnings pre-existing).
- `cargo fmt --all -- --check` clean in `src-tauri`.
- `cargo test` / Tauri build **not run here** (webkit2gtk/gtk3 missing) —
  first verified in CI on the next authorized push.

## Results / consequences

- The app makes **no network requests**; the CSP `connect-src` is
  `'self' ipc: http://ipc.localhost` (plus dev-server localhost in `devCsp`).
- Residual user state (`sync/state.json`, Credential Manager refresh token)
  is inert and can be deleted manually — see D-20261031-03 §5.
- Nothing was pushed; the work sits as uncommitted changes on `main` pending
  explicit authorization.
