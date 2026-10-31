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

## 2026-10-31 (later): FT-012 slice 1 — reading width (Linux, uncommitted)

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
- **Uncommitted** — commit/push needs explicit user authorization. Remaining
  FT-012 halves are visual (Windows session) and were deliberately not
  attempted here.
