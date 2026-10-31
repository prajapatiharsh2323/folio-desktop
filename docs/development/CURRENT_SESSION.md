# Current Session Checkpoint

**Session:** `S-20261031-04` — first Windows run; startup crash found and fixed
**Updated:** 2026-10-31
**Status:** the app now builds, launches, and stays open on Windows. The crash
was a jump-list COM defect ([A-BUG-20261031-01](audits/bugs/A-BUG-20261031-01-jumplist-startup-crash.md)).
All changes are **uncommitted**; commit/push needs explicit authorization.

## What happened

1. Built the app on the Windows host (first time full verification was possible
   here): `tsc -b` clean, Vitest 140/140, `vite build`, `pnpm tauri build` (NSIS).
2. User reported “the app closes when I start it”. Reproduced: exit code
   `0xC0000374` (`STATUS_HEAP_CORRUPTION`), Event Viewer 1000 in `ntdll.dll`.
3. Bisected to `jumplist::link_for()`: the `PKEY_Title` `VT_LPWSTR` pointed at a
   Rust `Vec<u16>`; the shell frees those values with `CoTaskMemFree`, so the
   Rust heap block was corrupted at startup.
4. Fixed with `CoTaskMemAlloc` + `PropVariantClear`; the title is also required
   for `AddUserTasks` (it returned `E_INVALIDARG` without it).
5. Re-verified: release exe and the reinstalled `%LOCALAPPDATA%\Folio` copy both
   open the `Folio` window and stay up; installer rebuilt with the fix.

## Verified current state (Windows 11 26100, this host)

- `pnpm exec tsc -b` — clean
- `pnpm exec vitest run` — **140 tests / 14 files** passing
- `pnpm exec vite build` — success
- `pnpm tauri build` — success; `Folio_0.1.0_x64-setup.exe` (3.74 MiB) rebuilt
  with the fix and installed silently over the previous copy
- `cargo fmt --all -- --check` — clean
- Manual launch (build tree + installed copy) — window opens, no fault events
- `cargo test --all-targets` on Windows — see `TASKS.md` “Verified state”

## Open work

- FT-001 visual check: pin Folio, right-click, confirm “Open Folio” /
  “Import file…” appear and launch.
- FT-002/FT-005/FT-006/FT-008 runtime items: unchanged, still Windows-session
  work (`R-20261031-02`, `A-20261031-01`).
- FT-004 dictionary pack: still an external release asset.

## Exact next action

Check the pinned taskbar jump list, then run the FT-005 performance procedure.
Commit/push of this session's fix needs user approval first.
