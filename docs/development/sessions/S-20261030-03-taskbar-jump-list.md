# S-20261030-03 — Taskbar jump list (FT-001)

**Date:** 2026-10-30
**Task:** FT-001
**Status:** complete; committed (`4cce075` code, `a5e4a94` docs) and pushed to
`origin/main` with user authorization

## Objective

Continue from the FT-007/FT-008 checkpoint which named FT-001 (taskbar jump
list, `.docs/09` §3 "Jump list (optional P1): Open Folio / Import file") as the
next unblocked P1.

## What this session did

1. **Confirmed the plumbing before writing any COM code.** `parse_args`
   already understands `--import`; the launch queue + `folio://launch` +
   frontend `pickImportFiles` reaction all existed. FT-001 therefore reduced
   to the Windows jump-list construction.
2. **Chose the implementation route deliberately.** The only wrapper crate
   (`jumplist_win` 0.0.4, 788 total downloads, unmaintained since 2024) was
   audited as a source reference and *not* adopted; instead the `windows`
   0.62.2 crate already in the tree (via Tauri) was used directly with
   feature opt-ins. Every API signature and the three CLSIDs were verified
   against the actual registry sources before writing the code (windows
   0.62 dropped coclass helpers; no `PROPVARIANT::from(&str)`; `PKEY_Title`
   lives in `Win32::Storage::EnhancedStorage`).
3. **Implemented `src-tauri/src/jumplist.rs`** (see
   [`I-20261030-03`](../plans/implementations/I-20261030-03-taskbar-jump-list.md)
   for the full design): portable `tasks()` data + cfg(windows) COM impl on a
   dedicated STA thread; registered in `lib.rs` setup after launch-arg
   parsing; added the `windows` feature flags to `Cargo.toml` and refreshed
   `Cargo.lock` (one line).
4. **Iterated against a real compiler.** The first draft had six genuine
   errors caught by a scratch `x86_64-pc-windows-gnu` check (missing
   `Win32_UI_Shell_PropertiesSystem` feature, missing `Interface` trait
   import for `cast()`, rustc's union-`DerefMut` lint on the
   `ManuallyDrop<PROPVARIANT_0_0>` field). Fixed with an explicit
   `DerefMut::deref_mut(&mut propvar.Anonymous.Anonymous)`.
5. **Raised the local verification bar beyond the usual gates.** Full-crate
   `cargo check --target x86_64-pc-windows-gnu --all-targets` passed with
   exit 0 (first such run here). Operating notes for replication:
   `-home` is a 4.8 GB partition that filled to 100% mid-check ("No space
   left on device" — also silently swallowed tool output); run with
   `CARGO_TARGET_DIR=/tmp/...`, and `zstd-sys` needs `mingw-w64`
   (`sudo apt-get install mingw-w64`).

## Verification

```
cargo fmt --all -- --check            # clean
cargo check --all-targets \
      --target x86_64-pc-windows-gnu  # exit 0, no warnings (2m18s)
./node_modules/.bin/tsc -b            # clean
./node_modules/.bin/vitest run        # 143 tests / 13 files pass
./node_modules/.bin/vite build        # success
```

Frontend unaffected — no TS changes this session.

## Unresolved

- Runtime taskbar verification needs real Windows (pin icon, exercise both
  entries) — the `cargo check` gate is compile-only.
- `cargo test --all-targets` (which would actually *run* the two new Rust
  tests) has its first chance in CI or on a Windows host. CI's
  `desktop-ci.yml` run for `4cce075` is the first compile/run gate.

## Exact next action

Committed as `4cce075` (code) + `a5e4a94` (docs) and pushed to
`origin/main` with authorization. Nothing pending on Git.
