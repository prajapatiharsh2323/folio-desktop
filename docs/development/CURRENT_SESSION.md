# Current Session Checkpoint

**Session:** `S-20261031-03` — Google Drive sync removal
**Updated:** 2026-10-31
**Status:** Drive sync **removed entirely** (user decision); ZIP backup is the
only library portability path. See
[D-20261031-03](decisions/D-20261031-03-google-drive-sync-removal.md).
All code-side tasks (FT-001…FT-008) have their Linux-side work done; every
remaining item needs a Windows desktop session or the dictionary pack asset
(FT-003 is retired with the feature).
`session.json` (previous transcript dump) remains the only untracked file.

## Completed in this session (Google Drive sync removal)

Deleted: `desktop/src/sync/` (6 modules), `src-tauri/src/oauth.rs`,
`src/components/CloudSyncSection.tsx`, `src/components/SyncScheduler.tsx`,
`tests/sync.test.ts`, and all wiring — Shell/Settings callsites, `lib.rs`
`mod oauth` + `oauth_*` handlers, `libraryPaths.syncState`, the
`.folio-sync-*` CSS block, Cargo deps (`keyring`, `reqwest`, `base64`,
`rand`, `url`; lockfile pruned), and every Google host in the CSP.
Untouched: `desktop/src/backup/`, `tests/backup.test.ts`, Settings Backup
section, `Manifest.libraryId` (schema-1, carried by backup v2 metadata).

## Verified current state

- Linux verification (2026-10-31), from `desktop/` — re-run end-to-end after
  resuming the interrupted session, same results:
  - `./node_modules/.bin/tsc -b` — clean
  - `./node_modules/.bin/vitest run` — **140 tests / 14 files** passing
    (the 9 deleted sync tests are the only delta from 149/15; two pre-existing
    `act(...)` warnings in `shell.test.tsx`)
  - `./node_modules/.bin/vite build` — success
  - `cd src-tauri && cargo fmt --all -- --check` — clean; `Cargo.lock` pruned
    by offline re-resolution (236 orphaned lines gone, no version bumps,
    no dangling references)
- Not run here: `cargo test` / Tauri build (Windows-only toolchain; per
  AGENTS.md do not mark them verified from this host). CI will run them on
  the Windows runner after the next authorized push.

## Open work (all blocked on non-code resources)

- Windows session: budget verdicts (FT-005), jump-list runtime checks
  (FT-001), reader/focus/screen-reader verifications (FT-006/008), restore
  swap (FT-007), scaling (FT-002).
- Asset: FT-004 dictionary pack (`mobile/tools/build_dict.py` — the mobile
  tree is absent from this repo).
- Historical note: users of older builds may still have an unused
  `<appDir>/sync/state.json` and a Windows Credential Manager refresh token;
  both are inert now.

## Exact next action

No further code-side work is actionable on this host. The next useful step is
a Windows run following the procedures in `R-20261031-02` and
`A-20261031-01`, or the remaining external-resource tasks. Any push/commit
needs explicit user authorization.
