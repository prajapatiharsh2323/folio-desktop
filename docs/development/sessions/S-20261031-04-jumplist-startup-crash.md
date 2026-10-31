# S-20261031-04 — First Windows run: startup crash found and fixed (FT-001)

**Date:** 2026-10-31
**Task:** FT-001 (taskbar jump list) — runtime verification finally possible
**Status:** complete; defect `fixed` and verified at runtime. Uncommitted.

## Objective

The user asked to build the application, then reported “the app closes when I
start it”. This session's job was the first real Windows execution of the
product (all previous verification was Linux-side source + CI).

## What was inspected / done

1. **Build (Windows host, first time possible here).**
   `pnpm exec tsc -b` clean, `pnpm exec vitest run` **140/140**, `vite build`
   success, `pnpm tauri build` → NSIS installer + release exe.
2. **Reproduced the crash.** Exit code `0xC0000374` (`STATUS_HEAP_CORRUPTION`),
   Event Viewer *Application Error* 1000 in `ntdll.dll` at `0x118095`, identical
   from the build tree and from the installed copy.
3. **Bisected with a throwaway probe binary** (five accumulating steps of the
   jump-list build, run standalone so the app under test was not disturbed).
   Step 4 — the `PKEY_Title` `PROPVARIANT` — reproduced the corruption; step 5
   (same call sequence, task-allocator string) was clean.
4. **Fixed `jumplist.rs`.** The title string now comes from `CoTaskMemAlloc` and
   is released by `PropVariantClear` after `SetValue`/`Commit`; the probe binary
   was deleted. Full detail: [`A-BUG-20261031-01`](../audits/bugs/A-BUG-20261031-01-jumplist-startup-crash.md).
5. **Re-verified at runtime.** Release exe stays alive past 15 s with window
   title `Folio` and a valid `MainWindowHandle`; no new faulting-application
   events; jump-list build no longer aborts startup.
6. **Rebuilt the installer** with the fix and recorded the gotcha in
   [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md).

## Verification (this session, Windows 11 26100)

- `pnpm exec tsc -b` — clean
- `pnpm exec vitest run` — 140 tests / 14 files passing
- `pnpm exec vite build` — success
- `pnpm tauri build` — success (release + NSIS)
- `cargo fmt --all -- --check` — clean
- `cargo test --all-targets` — **28 passed / 0 failed**
- Manual launch — window opens, no crash, no Application Error events

## Unresolved

- Visual confirmation of the pinned taskbar jump list (“Open Folio” /
  “Import file…” visible and clickable) — code path now runs without crashing,
  but the pinned-icon UI still needs an eyeball check.
- FT-002/FT-005/FT-006/FT-008 Windows runtime items are unchanged.

## Exact next action

Pin Folio to the taskbar, right-click the icon, and confirm both tasks appear
and launch. Then re-run the FT-005/FT-008 measurement procedures.
