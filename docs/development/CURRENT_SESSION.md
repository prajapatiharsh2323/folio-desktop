# Current Session Checkpoint

**Session:** `S-20261031-05` — audit repair batch 1 (Linux)
**Updated:** 2026-10-31
**Status:** done (Linux). Collections routing, reader navigation
coordination, menus/keyboard, and the dictionary removed — see
[`I-20261031-05`](plans/implementations/I-20261031-05-audit-repair-batch-1.md)
and [`S-20261031-05`](sessions/S-20261031-05-audit-repair-batch-1.md).
Committed and pushed to `origin/main` on 2026-10-31 (four topic commits,
`06f7338..db9708b`) with user authorization.

## Verified state (Linux, this session)

- `pnpm exec tsc -b` clean; `vite build` success
- Vitest **164 tests / 17 files** passing (baseline was 140/14)
- `cargo check --all-targets --target x86_64-pc-windows-gnu` exit 0;
  `cargo fmt --all -- --check` clean; `Cargo.lock` regenerated without
  `rusqlite`
- Tauri/NSIS runtime verification still requires a Windows host

## Exact next action

1. Windows session: run FT-009/010/011 runtime checks (collections
   round-trip, click zones, TOC/search jumps, menu auto-hide), then rebuild
   the NSIS installer with the dictionary-free tree.
2. Then the previously queued items: FT-005/FT-008 Windows measurements,
   FT-002 scaling check.
3. Commit/push only with user approval (per AGENTS.md git safety).
