# Folio Desktop — Remaining Work (Windows / CI)

These items were deferred during the Linux-side implementation and must be completed on Windows (or in CI) before release.

## Build / platform (Phase 11)
- Install the Rust toolchain and Windows build deps; run `cargo build` and `cargo test` in `desktop/src-tauri`.
- Run `pnpm tauri:dev` and `pnpm tauri:build` (NSIS installer).
- Register file associations (`.epub`, `.html`, `.txt`), single-instance handling, and jump list.
- Implement window size/position restore from `user/window.json` (restore-clamped to work area).
- Fullscreen reader (F11) custom chrome and OS display scaling checks.

## Phase 9 — Drive sync
- Loopback OAuth desktop client (system browser, PKCE, ephemeral 127.0.0.1 listener, refresh token in Windows Credential Manager, scope `drive.file`).
- Implement `sync/` module against `core/sync/*` semantics: `Folio Library/` layout, `state.json` drive/sha map, newest-wins merge, deletions-never-propagate, docId remap on identical contentHash, manifest uploaded last, failure classification UI copy.
- Wire `CloudSyncSection` (sign in, first-sync consent, auto-sync 15 min, "Sync now", status/failure banner + retry).
- Rust-side network/HTTP helpers if needed.

## Phase 10 — Dictionary
- Bundle the SQLite pack produced by `mobile/tools/build_dict.py`.
- Implement `dict_sqlite_query` in `src-tauri/src/commands/dict.rs` (currently a stub returning an error).
- Install-time sha256 verify of the dictionary pack.
- Headword normalization already ported in `src/dict/normalise.ts`; wire the meaning card to real lookups.
- GPL-2.0 attribution in card footer and Settings→About (already noted).

## Phase 11 — Polish
- Performance budget checks (04 §12): cold open ≤ 1.2 s, page turn ≤ 80 ms, 200 highlights ≤ 400 ms.
- Accessibility pass (03 §7): focus rings, tab order, ARIA, contrast.
- CI workflow (`.github/workflows/desktop-ci.yml`) per 09 §9.
- `cargo test` parity for path guard and fs commands.

## Known limitations carried over
- Tauri `cargo build` / `tauri:dev` could not be validated on the Linux host (missing webkit2gtk/gdk3).
- In-book/reader features that depend on the native webview (file drops, native dialogs) were exercised only via browser fallbacks.
- Sync and dictionary are skeleton-only; UI sections are placeholders.

## Quick verification commands (run on Windows)
```bash
cd desktop
pnpm install
npx tsc -b
npx vitest run
npx vite build
cargo test   # in src-tauri
pnpm tauri:dev
pnpm tauri:build
```
