# I-20261030-03 — Windows taskbar jump list (FT-001)

**Date:** 2026-10-30 (CI outcome added 2026-10-31)
**Task:** FT-001 (P1, `.docs/09-platform-decisions.md` §3: "Jump list (optional
P1): Open Folio / Import file")
**Status:** done — Linux + Windows-target compile verification green, **CI
(`desktop-ci`) green incl. `cargo test`**; runtime taskbar behaviour still
needs a manual pinned-icon check

## Scope

Pin two user tasks to Folio's taskbar icon when it is pinned on Windows:

- **Open Folio** — `Folio.exe` with no arguments.
- **Import file…** — `Folio.exe --import`.

## Design

### Entry point, not a new pipeline

The jump list is only an argv producer. Both flags already route through the
existing `open_files::parse_args` parser (`--import` → `import_requested` →
frontend `pickImportFiles`), first launch and single-instance relaunches
alike. No new IPC, no new event, no schema-1 impact.

### Implementation: `windows` crate COM, no new dependency

Decision against `jumplist_win` 0.0.4 (the only wrapper crate, unmaintained,
pinned to older `windows` versions): we **implemented
`ICustomDestinationList` directly** with the `windows` 0.62 crate that is
*already in the dependency tree* via Tauri — only its feature flags were
opted in. CLSIDs (not shipped by windows 0.62, which dropped coclass helpers)
are pinned locally and were verified against the `windows-sys` 0.61 registry
sources:

| Coclass / interface | GUID |
|---|---|
| `ShellLink` | `{00021401-0000-0000-c000-000000000046}` |
| `EnumerableObjectCollection` | `{2d3468c1-36a7-43b6-ac24-d3f02fd9607a}` |
| `DestinationList` | `{77f10cf0-3db5-4966-b520-b7c54fd35ed6}` |

Key correctness details (each verified against the crate sources):

- `CoInitializeEx(None, COINIT_APARTMENTTHREADED)` runs on a dedicated
  background thread so Tauri's main-thread apartment is untouched;
  `HRESULT::ok()` accepts both `S_OK` and `S_FALSE`.
- `BeginList` **must** be called before `AddUserTasks`, even though Folio
  ignores the removed-destinations array.
- No `SetAppID` call: the process-default AUMID (Tauri `productName` "Folio")
  is used, matching the installed app.
- Each task link: `IShellLinkW::SetPath(current_exe)` +
  `SetIconLocation(current_exe, 0)` + optional `SetArguments`, then the shell
  property store gets `PKEY_Title` (`VT_LPWSTR` PROPVARIANT built manually —
  windows 0.62 has no `PROPVARIANT::from(&str)`), then `Commit`. The
  `ManuallyDrop<PROPVARIANT_0_0>` union field must be dereferenced explicitly
  (`DerefMut::deref_mut`) — rustc rejects implicit writes there.
- The UTF-16 buffer behind the PROPVARIANT pointer outlives `SetValue`/`Commit`
  (same function scope); the PROPVARIANT is never `PropVariantClear`-ed since
  the buffer is caller-owned, not `CoTaskMemAlloc`-owned.
- Everything is best-effort: the whole build is wrapped so shell/COM failures
  can never block app start.

## Files touched

| File | Change |
|---|---|
| `desktop/src-tauri/src/jumplist.rs` | **new** — portable `JumpListTask` + `tasks()` (unit-tested), cfg(windows) COM impl, no-op `imp` for non-Windows |
| `desktop/src-tauri/src/lib.rs` | `mod jumplist;` + `jumplist::install()` in the setup hook (after launch-args parsing) |
| `desktop/src-tauri/Cargo.toml` | direct `windows = "0.62"` with the 8 feature modules needed (`Win32_UI_Shell`, `Win32_UI_Shell_Common`, `Win32_UI_Shell_PropertiesSystem`, `Win32_Storage_EnhancedStorage`, `Win32_System_Com`, `Win32_System_Com_StructuredStorage`, `Win32_System_Variant`, `Win32_Foundation`) |
| `desktop/src-tauri/Cargo.lock` | folio-desktop's dependency list gains `windows` (single line; package already locked at 0.62.2) |

## Verification (2026-10-30, Linux host)

- **Windows-target full-crate check** *(new capability on this host)*:
  `cargo check --target x86_64-pc-windows-gnu --all-targets` — **exit 0, no
  warnings** (2m 18s); this is the first full-crate Windows-target compile on
  this host. Replication: `CARGO_TARGET_DIR=/tmp/...` (the 4.8 GB `/home`
  partition fills to 100% mid-build) and `sudo apt-get install mingw-w64`
  (`zstd-sys` build script needs `x86_64-w64-mingw32-gcc`).
- `cargo fmt --all -- --check` — clean.
- Frontend untouched: `tsc -b` clean, **143 Vitest tests / 13 files** passing,
  `vite build` success.
- Rust unit tests (2, in `jumplist.rs`) compile under the Windows-target check
  and ran in CI (below).

## CI verification (2026-10-30/31, `desktop-ci` runs `41030635850` / `41030775733`)

The Windows runner (`windows-latest`) compiled and executed the module:

- `jumplist::tests::import_task_args_flow_through_arg_parser` … **ok** and
  `jumplist::tests::jump_list_tasks_are_open_and_import` … **ok** — the new
  Rust tests ran for real; `cargo test --all-targets` reported
  **31 passed / 0 failed** across the suite.
- `cargo fmt --all -- --check` — clean on Windows.
- `tsc -b`, Vitest, `vite build` — green.
- NSIS installer built as artifact.

## Still not verified

Runtime taskbar behaviour (pin the icon, see the two entries appear and work)
requires a real Windows desktop session — CI only proves compile + unit
tests. Check `pnpm tauri:build` → install → pin → exercise both entries
(including that the icon renders at index 0 of the exe — Tauri embeds the app
icon at index 0).

## Follow-ups

1. Windows runtime check of both jump-list entries.
2. Optional later enhancement: recent-documents category (AppendCategory) —
   out of scope for 09 §3's minimal two tasks.
