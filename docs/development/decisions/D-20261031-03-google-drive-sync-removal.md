# D-20261031-03 — Google Drive sync is removed; ZIP backup is the only library portability path

**Status:** adopted 2026-10-31
**Supersedes:** feature work in D-006 (Drive sync semantics), D-007 (Drive REST as the only network use)
**Affects:** `desktop/src/` (sync module deleted), `desktop/src-tauri/` (OAuth deleted), `desktop/tests/`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`

## Context

Drive sync (Phase 9) shipped code-complete but never ran end-to-end: it
required a Google OAuth **Desktop app** client ID that was never available in
the repo, and the whole E2E task (FT-003) stayed blocked on external
credentials. The desktop app already has a fully local, validated ZIP backup
(`desktop/src/backup/`, D-20261030-01). Carrying an untestable network feature
as dead-but-live surface (OAuth commands, keyring token storage, Google CSP
grants, auto-sync scheduler) was cost without benefit.

## Decision

1. **Remove the feature entirely.** Deleted:
   `desktop/src/sync/` (`auth`, `driveClient`, `engine`, `merge`, `state`,
   `status`), `desktop/src-tauri/src/oauth.rs` (loopback OAuth + keyring),
   `desktop/src/components/CloudSyncSection.tsx`,
   `desktop/src/components/SyncScheduler.tsx`, `desktop/tests/sync.test.ts`
   (9 cases), and their wiring in `Shell.tsx` / `SettingsScreen.tsx` /
   `src-tauri/src/lib.rs` / `libraryPaths.ts` (`syncState` helper) /
   `styles/components.css` (`.folio-sync-*` block).
2. **Remove the dependency surface.** Cargo drops `keyring`, `reqwest`,
   `base64`, `rand` (only `oauth.rs` used them); `Cargo.lock` pruned. The CSP
   loses all Google hosts — `connect-src` is now only
   `'self' ipc: http://ipc.localhost` (+ localhost dev servers in `devCsp`).
   The app makes **no network requests** after this change.
3. **ZIP backup is unchanged** and is the only cross-device transfer path.
   No import exists between `src/backup/` and the deleted `src/sync/`;
   `tests/backup.test.ts` passes untouched. The Settings Backup section and
   `recoverInterruptedRestore` remain in place.
4. **Schema-1 compat untouched.** `Manifest.libraryId` stays in
   `desktop/src/model/types.ts` (frozen schema-1 field; backup v2 metadata
   copies it, D-20261030-01). Only the stale "used by Drive mirror" comment
   changed. Orphaned localStorage keys (`folio.sync.auto`,
   `folio.sync.clientId`, `folio.sync.clientSecret`) are simply abandoned —
   no cleanup code was added for them.
5. **Users with residual state**: a `sync/state.json` left by an older build
   is ignored (nothing reads or writes it) and can be deleted manually; the
   Windows Credential Manager refresh token becomes unusable and can be
   removed by the user.

## Alternatives rejected

- **Keep the code harmless-but-dormant behind a flag.** Preserves OAuth,
  keyring, network, and CSP attack/maintenance surface for a feature that
  cannot be tested without external credentials.
- **Remove sync but keep the Rust OAuth stack.** Dead code in the thin OS
  bridge; `reqwest`/`keyring` would remain linked for no user.
- **Defer alongside an FT-003 credential push.** The blocker was a
  third-party credential that belongs outside the repo; no timeline existed.

## Consequences

- Test count drops by the 9 sync cases (they died with the feature, not a
  regression — all remaining suites stay green: 140 tests / 14 files,
  Linux 2026-10-31).
- D-006 / D-007 remain as historical records but describe retired code;
  `.docs/05` §6 is marked retired rather than rewritten (frozen contract doc).
- `desktop/README.md` Phase 9 log is historical; `REMAINING.md` marks the
  phase removed. If cloud sync is ever re-proposed, it is a **new** decision
  with its own threat model, not a revival of this code.
