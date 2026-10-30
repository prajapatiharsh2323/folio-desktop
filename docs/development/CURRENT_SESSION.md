# Current Session Checkpoint

**Session:** `S-20261030-03` — taskbar jump list (FT-001)
**Updated:** 2026-10-30
**Status:** FT-007 + FT-008 + FT-001 implemented; **committed locally up to
FT-008** (`2dce770` FT-007, `72d2a04` FT-008, docs follow-up `43a6b0b`) —
**FT-001 is uncommitted and nothing is pushed**; `main` is ahead of
`origin/main` by 6 commits plus the uncommitted FT-001 changes

## Verified current state

- Branch `main`; local commits `2211d7f … 43a6b0b` (6 ahead). Uncommitted:
  FT-001 code (`jumplist.rs` new, `lib.rs`, `Cargo.toml`, `Cargo.lock`) and
  these records. `session.json` at the repo root is still the old transcript
  dump of the failed build session (not code; safe to delete).
- Linux verification from `desktop/` (2026-10-30, after FT-001 changes):
  - `./node_modules/.bin/tsc -b` — clean
  - `./node_modules/.bin/vitest run` — **143 tests / 13 files** passing
  - `./node_modules/.bin/vite build` — success (existing >500 kB chunk warning)
  - `cd src-tauri && cargo fmt --all -- --check` — clean
  - **New gate:** `cargo check --all-targets
    --target x86_64-pc-windows-gnu` — **exit 0, no warnings** (2m 18s), the
    first full-crate Windows-target compile on this host. Replication notes:
    `CARGO_TARGET_DIR=/tmp/...` (the 4.8 GB `/home` partitions fills at 100%
    mid-build) and `sudo apt-get install mingw-w64` (needed by the
    `zstd-sys` build script).
- `cargo test`, `pnpm tauri:dev`/`tauri:build` and all *runtime* behaviours
  were **not** run here. The jump list's runtime taskbar behaviour also needs
  a real Windows run. Do not describe them as verified.

## Completed in this session

1. FT-001 in `desktop/src-tauri/src/jumplist.rs` (new): two user tasks —
   "Open Folio" (no args) and "Import file…" (`--import`) — built through COM
   `ICustomDestinationList` on a dedicated STA thread, best-effort (shell
   failures can never block launch). Uses the `windows` 0.62 crate already in
   the dependency tree (only feature flags added to `Cargo.toml` +
   one-line `Cargo.lock` refresh); `jumplist_win` was audited and rejected as
   a dependency. Registered as `mod jumplist;` + `jumplist::install()` in the
   `lib.rs` setup hook, after launch-args parsing (the tasks' argv flows
   through the existing `open_files::parse_args` pipeline; frontend needs no
   change).
2. All records written:
   [`I-20261030-03`](plans/implementations/I-20261030-03-taskbar-jump-list.md),
   [`S-20261030-03`](sessions/S-20261030-03-taskbar-jump-list.md);
   `TASKS.md`, `REMAINING.md`, and both record indexes updated.
3. Caught 6 real compile errors early via a scratch windows-target check
   before CI (missing `Win32_UI_Shell_PropertiesSystem` feature, missing
   `Interface` import for `cast()`, rustc's union-`DerefMut` lint on
   `ManuallyDrop<PROPVARIANT_0_0>`).

## Open work

See [`TASKS.md`](TASKS.md). All of FT-001/007/008 still need Windows runtime
verification; remaining open items: perf budgets (FT-005), a11y audit
(FT-006), scaling check (FT-002), Drive E2E (FT-003), dictionary pack (FT-004).
Committing/pushing requires explicit user authorization.

## Exact next action

1. Ask the user for the FT-001 commit decision (single `feat(jumplist):` code
   commit + separate docs commit, matching the FT-007/008 pattern), then
   commit **only after authorization**. Nothing is pushed.
2. Pushing `main` (currently 6 local commits, soon 8) still needs explicit
   user authorization — the remote is the only durable copy.
