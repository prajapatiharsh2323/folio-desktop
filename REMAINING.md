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
- [ ] Taskbar jump list ("Open Folio" / "Import file…") — P1, still open.
- [x] Window size/position restore, clamped to the monitor work area
      (`window_state.rs`, preserves unknown `window.json` keys).
- [x] Native F11 fullscreen + Escape exit (`src/lib/fullscreen.ts`, `Shell.tsx`).
- [ ] OS display-scaling check (100/125/150/200%) on real hardware.

## Phase 9 — Drive sync

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
      (credentials are not in the repo; see `desktop/README.md`).

## Phase 10 — Dictionary

- [ ] Bundle the SQLite pack produced by `mobile/tools/build_dict.py` (asset is
      not in this repo). Drop it into `src-tauri/dict/` before release.
- [x] `dict_sqlite_query` / `dict_lookup` / `dict_status` with schema
      introspection, inflection fallback, and grouped senses.
- [x] Install-time sha256 verify (`folio-eng-hin.sha256` next to the pack).
- [x] Meaning card wired to real lookups with loading/empty/missing/error states
      and reading-theme styling.
- [x] GPL-2.0 attribution in the card footer and Settings→About, plus installed
      pack status.

## Phase 11 — Polish

- [ ] Performance budget checks (04 §12): cold open ≤ 1.2 s, page turn ≤ 80 ms,
      200 highlights ≤ 400 ms.
- [ ] Accessibility pass (03 §7): focus rings, tab order, ARIA, contrast.
- [x] CI workflow (`.github/workflows/desktop-ci.yml`): Windows runner, pnpm,
      tsc, Vitest, Vite build, `cargo fmt --check`, `cargo test`, NSIS build,
      installer artifact.
- [x] `cargo test` parity for path guard, fs commands, app-dir mapping,
      window-state clamping, launch parsing, dictionary, OAuth helpers.

## Known limitations

- OS display-scaling checks (100/125/150/200%) need real hardware.
- Drive sync requires a Google OAuth **Desktop app** client ID (build-time env
  or the in-app field) and network access; it is not exercised in unit tests.
- The dictionary pack is a release asset, not checked into the repo; until it is
  present Settings shows “Pack not installed” and the meaning card reports the
  missing pack.
- Jump list and perf/a11y audits remain open (jump list is P1 per 09 §3).

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
