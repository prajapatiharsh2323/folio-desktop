# Current Session Checkpoint

**Session:** `S-20261031-06` — Windows host, automated half of `MANUAL-TASKS.md`
**Updated:** 2026-10-31
**Status:** automated verification done on Windows (green); runtime/visual
checks still need a person at the screen. Record:
[`S-20261031-06`](sessions/S-20261031-06-windows-manual-verification.md).
Previous: `S-20261031-05` audit repair batch 1 —
[`I-20261031-05`](plans/implementations/I-20261031-05-audit-repair-batch-1.md).
Committed and pushed to `origin/main` on 2026-10-31 (batch 1 `06f7338..db9708b`,
later FT-012 slices `4920418..bba37e7`) with user authorization; CI is now
observed **green on all of them** (`desktop-ci` #11–#15).

## Exact next action

1. At the screen: walk `MANUAL-TASKS.md` §1 runtime blocks (FT-009/010/011/012)
   against the freshly built installer or `pnpm tauri:dev`.
2. Then FT-007 restore interrupt round-trip, FT-005 measurements, FT-001
   jump-list eyeball, FT-002 scaling, FT-006 screen reader.
3. Commit/push only with user approval (per AGENTS.md git safety).

## Verified state (Linux, `S-20261031-05`)

- `pnpm exec tsc -b` clean; `vite build` success
- Vitest **164 tests / 17 files** passing (baseline was 140/14)
- `cargo check --all-targets --target x86_64-pc-windows-gnu` exit 0;
  `cargo fmt --all -- --check` clean; `Cargo.lock` regenerated without
  `rusqlite`
- Tauri/NSIS runtime verification still requires a Windows host

## 2026-10-31 (Windows host, `S-20261031-06`): automated half of the manual list

Ran on Windows 11 26100 — this repo is now being worked from a Windows machine,
so the automatable items in `MANUAL-TASKS.md` were executed instead of deferred:

- `pnpm install` up to date (pnpm 11.9.0 / Node 24.18.0); `tsc -b` exit 0;
  Vitest **173 / 173 (18 files)**; `vite build` success 20.1 s.
- `cargo test --all-targets` **23 passed / 0 failed**; `cargo fmt --all --
  --check` clean. (28 before the dictionary removal dropped the `rusqlite`
  cases — count change recorded, not a regression.)
- `pnpm tauri:build` **success**: release 4 m 20 s, NSIS
  `desktop/src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe`
  (3 206 393 bytes / 3.06 MiB) — first dictionary-free installer, first with
  the FT-012 slices.
- Launch smoke test: release exe alive at 8 s, window `Folio`, 31.2 MB RSS,
  then stopped.
- CI `desktop-ci` #13 (`bba37e7`) / #14 (`8a9ca1e`) / #15 (`ae6bd86`) all
  success. `%APPDATA%\Folio\dict\` absent — orphan cleanup N/A.
- Gotcha: `pnpm` resolves only as `pnpm.cmd` here (`pnpm.ps1` blocked by
  execution policy; `Get-ExecutionPolicy` fails too). A long foreground
  `tauri:build` was aborted by a tool timeout — background + log file worked.
- Still human-only: all §1 runtime checks, the §2 restore round-trip, §3
  perf, §4 jump-list eyeball, §5 polish/a11y/scaling, `Ctrl+Q` decide/implement.
- Uncommitted. Record:
  [`S-20261031-06`](sessions/S-20261031-06-windows-manual-verification.md).

## 2026-10-31 (later, `S-20261031-05`): FT-012 slice 1 — reading width (Linux)

- The dead `maxWidth` schema field now works (04 §3 "desktop may honor as
  column cap"): `ReaderScreen` caps the reading canvas
  (`max-width` + `margin: 0 auto`, centering an absolutely-positioned canvas);
  chrome/panels/search are untouched.
- Appearance panel: new "Reading width" section — "Full width" chip (0) plus
  a 480..1600 px slider stepped 20 px; `clampMaxWidth` added to
  `model/defaults.ts`.
- Tests: `model.test.ts` gained 3 cases (clamp behavior + schema-1
  `ReadingPrefs` shape guard).
- Linux verification: `tsc -b` clean; **167 Vitest tests / 17 files** passing;
  `vite build` success.
- Pushed to `origin/main` on 2026-10-31 with user authorization
  (`4920418..bba37e7`, CI never observed yet on these). Remaining FT-012
  halves are visual (Windows session) and were deliberately not attempted
  here.

## 2026-10-31 (later): FT-012 slice 2 — pointer parity (Linux, this commit)

- **Pillar hover reveal (07 §2):** `ChromeStateMachine.onPillarHover()` holds
  the chrome visible 3 s after a cursor enters the bottom 40 px, even at rest;
  `onActivity`/`toggle` clear the grace. `ReaderScreen.onMouseMove` now zones.
- **Right-click menu (07 §3):** the engine seam gained `onContextMenu` — the
  Readium toolkit already blocks the native menu inside the spine frame and
  reports `(x, y)`; `ReaderScreen` shows a reduced anchored menu
  (`ReaderContextMenu`: toggle toolbar / TOC / bookmark) or, with an active
  selection, re-anchors the selection toolbar at the cursor. Root-level
  fallback covers right-clicks outside the iframe; overlays excluded. Escape
  ladder: menu → ctx menu → panel → search → selection.
- **Tooltips:** Back and More chrome buttons carry `title` (Appearance/Search
  already did).
- Tests: 4 ChromeStateMachine pillar-hover cases; 4 `ReaderContextMenu`
  component cases (`readerContextMenu.test.tsx`).
- Linux verification: `tsc -b` clean; **173 Vitest tests / 18 files** passing;
  `vite build` success.
- CI (observed on GitHub): windows-latest green for the pushed batch-1 commits
  (`db9708b` run 11) and the records commit (`86ba918` run 12).
- Remaining FT-012 halves stay visual (Windows session); right-click behaviour
  inside the real webview also needs a Windows run.

## 2026-10-31 (later): keyboard/global matrix parity patch (Linux, this commit)

- **Library keys (07 §1/§4):** `Ctrl+F` opens the library search panel (same
  as `/`); `Ctrl+I` opens the import picker; both case-tolerant and
  typing-target guarded.
- **Reader media keys (07 §2):** `MediaTrackNext` / `MediaTrackPrevious`
  page turn (the spec's only two bound HID keys).
- **Overscroll (04 §5):** `overscroll-behavior: none` on body — body
  overscroll can no longer navigate/reload the webview.
- Already present and verified by inspection: window min size 720×560
  (tauri.conf.json), `Ctrl+,` and `Ctrl+1..4` (Shell), `Ctrl+F` in-reader.
- `Ctrl+Q` quit-with-confirm is **not** implemented (needs a confirm dialog +
  a Rust/Tauri exit path — queued for the Windows pass; see the manual
  checklist).
- Linux verification: `tsc -b` clean; Vitest **173/173** (18 files); `vite
  build` success.
- Everything Linux-verifiable is now done. The open checklist that needs a
  real Windows host lives in the repo root: [`MANUAL-TASKS.md`](../../../MANUAL-TASKS.md).
