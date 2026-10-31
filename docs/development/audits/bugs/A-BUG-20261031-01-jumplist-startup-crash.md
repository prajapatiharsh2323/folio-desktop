# A-BUG-20261031-01 — Startup crash: heap corruption from the jump-list title PROPVARIANT

**Date:** 2026-10-31
**Area:** Rust shell integration — taskbar jump list (`desktop/src-tauri/src/jumplist.rs`)
**Severity:** Blocker — the app never opened on Windows
**Status:** `fixed` (verified at runtime on Windows 11 26100)
**Introduced by:** FT-001 jump list ([`S-20261030-03`](../../sessions/S-20261030-03-taskbar-jump-list.md)); the code had never been executed on a real Windows host

## Environment

- Windows 11 build 26100 (26100.9711 `ntdll.dll`), x86_64
- Release build `folio-desktop 0.1.0` (`cargo build --release` / NSIS bundle), commit `8b714bb`
- Reproduced with both `desktop/src-tauri/target/release/folio-desktop.exe` and the
  installed copy at `%LOCALAPPDATA%\Folio\folio-desktop.exe`

## Reproduction

1. Build with `pnpm tauri build` (or run the release exe directly).
2. Start the app.
3. The window never appears; the process exits immediately.

## Expected vs actual

- **Expected:** the Library window opens and stays open.
- **Actual:** process dies during startup. `Start-Process -Wait` reports
  `-1073740940` (`0xC0000374`, `STATUS_HEAP_CORRUPTION`); Event Viewer
  *Application Error* 1000 names `ntdll.dll` (fault offset `0x118095`) every time.

## Bisect

A temporary probe binary (`src/bin/jl_probe.rs`, since deleted) replayed the
jump-list build in five steps. Steps 1–3 exited 0 (but `AddUserTasks` returned
`E_INVALIDARG`), step 4 — which added the `PKEY_Title` value — crashed with the
same `0xC0000374`. Step 5, identical except that the string came from
`CoTaskMemAlloc` and was released with `PropVariantClear`, exited 0 **and**
`AddUserTasks`/`CommitList` both succeeded.

Disabling `jumplist::install()` in `lib.rs` also made the app start normally,
confirming the jump-list path as the sole cause.

## Root cause

`link_for()` built the task title as:

```rust
let mut wide: Vec<u16> = task.title.encode_utf16().chain(once(0)).collect();
fields.vt = VT_LPWSTR;
fields.Anonymous.pwszVal = PWSTR(wide.as_mut_ptr());
```

A `VT_LPWSTR` value in a `PROPVARIANT` is COM task-allocator memory: the shell
frees such strings with `CoTaskMemFree`. Handing it a Rust `Vec` buffer means
the shell frees (or later re-reads) a block the Rust allocator still owns —
classic heap-metadata corruption, reported by `ntdll` at the first heap
operation afterwards. `drop(propvar)` was a no-op (`PROPVARIANT` has no `Drop`
in `windows` 0.62), so nothing in our code masked or repaired it.

Secondary finding: the title is not cosmetic. Without `PKEY_Title`, the shell
rejects the task array with `E_INVALIDARG` (`0x80070057`), so tasks can only be
added through this (previously crashing) path.

## Fix

`desktop/src-tauri/src/jumplist.rs`:

- allocate the title with `CoTaskMemAlloc` and copy the UTF-16 code units in;
- `SetValue` + `Commit`, then `PropVariantClear` the still-owned
  `PROPVARIANT`, which frees the task-memory string exactly once;
- `E_OUTOFMEMORY` on a null allocation; the value is cleared on every path;
- comment records the failure mode so the pattern is not reintroduced.

No schema-1, manifest-ordering, path-ownership, or privacy invariants are
touched: this is startup-only COM code and stays failure-tolerant (a failed
jump list still never blocks launch).

## Verification

- `cargo build --release` → app runs 15 s+ with window `Folio`
  (`MainWindowTitle`, valid `MainWindowHandle`), no new *Application Error*
  events.
- `cargo fmt --all -- --check` clean; `tsc -b` clean; `vitest run` 140/140;
  `cargo test --all-targets` 28/28; `vite build` and `pnpm tauri build` (NSIS)
  succeed.
- The rebuilt installer was installed silently over the previous copy and the
  installed `%LOCALAPPDATA%\Folio\folio-desktop.exe` launches and stays open.
- Runtime *visual* confirmation that the pinned taskbar icon shows the two
  tasks remains open under FT-001 (it needs a manual pin + eyeball check).

## Follow-up

- The pattern "COM wants task memory, Rust gave it a `Vec`" is now a recorded
  gotcha in [`PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md).
- The probe binary was deleted; the bisect method is described above in case a
  similar startup crash appears in future COM code.
