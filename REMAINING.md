# Folio Desktop — Remaining Work (Windows / CI)

Status as of the Windows pass. Items are checked when implemented **and**
verified locally (tests/build); runtime-only checks are called out explicitly.

## Build / platform (Phase 11)

- [x] Rust toolchain + Windows build deps; `cargo test` green (28 tests).
- [x] Release binary starts and creates `%APPDATA%/Folio/{library,user}`
      (10-second smoke test with the built `folio-desktop.exe`).
- [x] `pnpm tauri:dev` launches the app (dev smoke test; Vite ignores
      `src-tauri/**` so cargo's locked debug DLL cannot crash the watcher).
- [x] `pnpm tauri:build` produces the NSIS installer:
      `desktop/src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe`
      (4.10 MiB).
- [x] File associations (`.epub`, `.html`/`.htm`, `.txt`) in `tauri.conf.json`.
- [x] Single-instance handling + open-with hand-off (`open_files.rs`, `folio://launch`).
- [x] Taskbar jump list ("Open Folio" / "Import file…")
      (`src-tauri/src/jumplist.rs`, COM `ICustomDestinationList`, no extra
      dependency; compiled against the `x86_64-pc-windows-gnu` target and
      fmt/tests checked — **runtime taskbar behaviour still needs a real
      Windows run**).
- [x] Window size/position restore, clamped to the monitor work area
      (`window_state.rs`, preserves unknown `window.json` keys).
- [x] Native F11 fullscreen + Escape exit (`src/lib/fullscreen.ts`, `Shell.tsx`).
- [ ] OS display-scaling check (100/125/150/200%) on real hardware.

## Phase 9 — Drive sync (removed 2026-10-31)

> The feature shipped behind the items below, but was **removed entirely**
> (code, OAuth, CSP grants, settings card — see D-20261031-03). The ZIP
> backup (`desktop/src/backup/`, Settings → Backup) is the only
> library portability path. The checklist is kept as a historical record;
> the former `sync/` module, `src-tauri/src/oauth.rs`, `CloudSyncSection`,
> `SyncScheduler`, and `tests/sync.test.ts` no longer exist.

- [x] Loopback OAuth desktop client: system browser, PKCE S256, ephemeral
      `127.0.0.1` listener, refresh token in Windows Credential Manager,
      scope `drive.file` (`src-tauri/src/oauth.rs`).
- [x] `sync/` module: `Folio Library/` layout, `sync/state.json` drive/sha map,
      newest-wins merge, deletions-never-propagate, user JSON per-id merge,
      docId remap on identical contentHash, manifest uploaded last, failure
      classification (`src/sync/`, 9 Vitest cases).
- [x] `CloudSyncSection`: connect + first-sync consent, Sync now, disconnect,
      opt-in 15-minute auto-sync, status/failure banner + Retry.
- [x] Rust-side HTTP (`reqwest`) token exchange with native TLS.
- [ ] End-to-end run against Google Drive with a real OAuth Desktop client ID
      (moot — credentials were never in the repo and the feature is removed).

## Phase 10 — Dictionary (removed 2026-10-31)

> The entire offline-dictionary feature was **removed** after the
> 2026-10-31 application audit — the pack asset could never be built here
> (the `mobile/` tree is not in this repo) and a dormant `rusqlite`/UI
> integration was cost without benefit.
> See `docs/development/decisions/D-20261031-05-dictionary-removal.md`.
> The bullets below are the historical pre-removal state.

- ~~Bundle the SQLite pack produced by `mobile/tools/build_dict.py`~~
  (superseded by the removal).
- ~~`dict_sqlite_query` / `dict_lookup` / `dict_status`~~ *(removed)*.
- ~~Meaning card, Settings→About dictionary rows~~ *(removed)*.
- `tests/noDictionary.test.ts` now guards against re-introduction.

## Phase 11 — Polish

- [x] Performance budget checks (04 §12): cold open ≤ 1.2 s, page turn ≤ 80 ms,
      200 highlights ≤ 400 ms — harness + method + Linux baseline done
      (`scripts/perf.ts`; reader-parse 316 ms). **Runtime verdicts still need
      a real Windows run** (procedure in `docs/development/audits/results/`).
- [ ] Accessibility pass (03 §7): focus rings, tab order, ARIA, contrast.
- [x] CI workflow (`.github/workflows/desktop-ci.yml`): Windows runner, pnpm,
      tsc, Vitest, Vite build, `cargo fmt --check`, `cargo test`, NSIS build,
      installer artifact.
- [x] `cargo test` parity for path guard, fs commands, app-dir mapping,
      window-state clamping, launch parsing, (the dictionary tests were
      removed with the feature, 2026-10-31; OAuth helpers were removed with
      Drive sync, 2026-10-31).

## Known limitations

- OS display-scaling checks (100/125/150/200%) need real hardware.
- The app makes no network requests since Google Drive sync was removed
  (2026-10-31); cross-device transfer is via ZIP backup/restore.
- The offline dictionary was removed entirely (2026-10-31,
  D-20261031-05); an earlier install's `%APPDATA%/Folio/dict/` copy is
  orphaned and can be deleted manually.
- Perf/a11y: code-side audit + harness are recorded (`A-20261031-01`,
  `R-20261031-02`); the **runtime** halves (performance verdicts, screen
  reader, jump-list taskbar behaviour) still need a real Windows run (P2;
  jump list is P1 per 09 §3).

## Quick verification commands (run on Windows)

```bash
cd desktop
pnpm install
pnpm exec tsc -b
pnpm exec vitest run
pnpm exec vite build
cargo fmt --all -- --check   # in src-tauri
cargo test                   # in src-tauri
pnpm tauri:dev
pnpm tauri:build             # NSIS installer
```
