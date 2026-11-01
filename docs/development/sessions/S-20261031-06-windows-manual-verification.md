# S-20261031-06 — Windows host: automated half of `MANUAL-TASKS.md`

**Date:** 2026-10-31
**Task:** `MANUAL-TASKS.md` §1 (build), §2 (`cargo`), §6 (housekeeping)
**Status:** complete for the automated items; human-only checks remain. Uncommitted.

## Objective

`MANUAL-TASKS.md` was written on Linux because the remaining work "requires a
real Windows/webview session". This session ran on Windows 11 26100, so the
automatable half was executed here: install, typecheck, tests, frontend build,
Rust tests, format check, the first dictionary-free NSIS installer, and the
housekeeping items. The visual/runtime items were **not** attempted — they need
a person at the screen.

## What was done

1. **Environment.** `pnpm install --prefer-offline` — up to date (pnpm 11.9.0,
   Node 24.18.0). `cargo`/`rustc` present. `desktop/node_modules` already
   populated.
2. **Frontend verification.** `tsc -b` exit 0; `vitest run` **173 passed / 18
   files** (66.0 s); `vite build` success in 20.1 s (index chunk 665.03 kB,
   gzip 192.90 kB — the pre-existing chunk-size warning, unchanged).
3. **Rust verification.** `cargo test --all-targets` **23 passed / 0 failed**,
   exit 0; `cargo fmt --all -- --check` clean.
4. **Installer.** `pnpm tauri:build` — frontend `pnpm build`, release compile
   **4 m 20 s**, NSIS
   `desktop/src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe`
   (**3 206 393 bytes / 3.06 MiB**); release exe 11 678 208 bytes. First
   NSIS build of the dictionary-free tree (D-20261031-05) and the first to
   include the FT-012 slices.
5. **Launch smoke test.** Started the build-tree release exe: `HasExited=False`
   after 8 s, `MainWindowTitle=Folio`, 31.2 MB working set, then stopped
   deliberately. No crash, no faulting-application event looked for beyond
   liveness — this is a smoke test, not the FT-009–012 runtime pass.
6. **Housekeeping.** CI via the GitHub API: runs **#13 `bba37e7`, #14
   `8a9ca1e`, #15 `ae6bd86` all `success`** on `desktop-ci` (windows-latest).
   `%APPDATA%\Folio\dict\` does not exist on this machine — only `library\`
   and `user\` — so the orphan-cleanup item is N/A rather than done.

## Verification evidence

| Check | Command | Result |
|---|---|---|
| Install | `pnpm install` | up to date |
| Typecheck | `pnpm exec tsc -b` | exit 0 |
| Tests | `pnpm exec vitest run` | 173 / 173, 18 files |
| Frontend build | `pnpm exec vite build` | success, 20.1 s |
| Rust tests | `cargo test --all-targets` | 23 passed / 0 failed |
| Rust format | `cargo fmt --all -- --check` | clean |
| Installer | `pnpm tauri:build` | success, `Folio_0.1.0_x64-setup.exe` 3.06 MiB |
| Launch | release exe, 8 s | alive, window `Folio`, 31.2 MB |
| CI | GitHub API `actions/runs` | #13–#15 success |

## Notes and decisions

- **Rust test count 28 → 23.** The figure recorded for `S-20261031-04` was 28.
  The dictionary removal (D-20261031-05) deleted the `rusqlite`-backed cases, so
  23 is the expected post-removal count; the surviving tests are
  `appdir`, `guard`, `commands::fs`, `jumplist`, `open_files`,
  `window_state`. Recorded as a count change, **not** as a regression, and the
  older figure is left in place as history. No test was skipped or ignored.
- **`pnpm.ps1` is unusable in this environment.** Execution policy blocks the
  shim, and `Get-ExecutionPolicy` itself fails because
  `Microsoft.PowerShell.Security` will not autoload. All commands were run via
  `pnpm.cmd`. Harmless for the product; worth knowing for scripted sessions.
- **`Select-Object -Last N` on a long-lived foreground build aborted** the first
  `tauri:build` attempt (tool interruption). Re-ran it in the background with a
  log file instead. No partial artifact was promoted; the successful build
  overwrote the output directory cleanly.
- Unstruck in `MANUAL-TASKS.md`: §1 runtime checks (FT-009/010/011/012), §2
  restore swap/rollback round-trip, §3 FT-005 measurements, §4 jump-list
  eyeball, §5 polish/a11y/scaling/Ctrl+Q.

## Unresolved

- All human-at-the-screen items listed above.
- `Ctrl+Q` quit-with-confirm (07 §1) still unimplemented and undecided —
  suggested to implement last, after the verification passes.
- The new installer has **not** been installed over the existing
  `%LOCALAPPDATA%\Folio` copy; the smoke test used the build-tree exe only.

## Exact next action

Run `pnpm tauri:dev` (or install the new setup exe) and walk the four runtime
blocks in `MANUAL-TASKS.md` §1 — FT-009 collections round-trip, FT-010 click
zones / TOC+search jumps / pillar scrub, FT-011 Escape ladder + open-menu
hover + Ctrl+B, FT-012 reading-width slider / right-click menu / pillar grace.
Note failures here; code fixes happen on the Linux side.
