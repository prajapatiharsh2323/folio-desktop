# Session Records

One record per substantial working session. Keep `CURRENT_SESSION.md` as the
short live checkpoint and put narrative history here.

| ID | Date | Title | Outcome | Record |
|---|---|---|---|---|
| S-20261029-01 | 2026-10-29 | Development knowledge system bootstrap | Complete; committed locally, not pushed | [`S-20261029-01-bootstrap.md`](S-20261029-01-bootstrap.md) |
| S-20261030-01 | 2026-10-30 | Backup/restore hardening (Phase 1) | Complete; uncommitted, Linux-verified | [`S-20261030-01-backup-restore-hardening.md`](S-20261030-01-backup-restore-hardening.md) |
| S-20261030-02 | 2026-10-30 | Reader locator correctness (FT-008), resumed after interrupted session | Complete; uncommitted, Linux-verified | [`S-20261030-02-reader-locator-correctness.md`](S-20261030-02-reader-locator-correctness.md) |
| S-20261030-03 | 2026-10-30 | Taskbar jump list (FT-001) | Complete; committed (`4cce075`) + pushed, CI green | [`S-20261030-03-taskbar-jump-list.md`](S-20261030-03-taskbar-jump-list.md) |
| S-20261031-01 | 2026-10-31 | Accessibility pass (FT-006) | Complete (code side); committed + pushed; screen-reader/target-size items open | [`S-20261031-01-accessibility.md`](S-20261031-01-accessibility.md) |
| S-20261031-02 | 2026-10-31 | Performance budget harness + method (FT-005) | Harness + method + Linux baseline done; committed + pushed; runtime verdicts pending Windows | [`S-20261031-02-perf-budget-harness.md`](S-20261031-02-perf-budget-harness.md) |
| S-20261031-04 | 2026-10-31 | First Windows run: jump-list startup crash fixed (FT-001) | Complete; heap-corruption fix verified at runtime; uncommitted | [`S-20261031-04-jumplist-startup-crash.md`](S-20261031-04-jumplist-startup-crash.md) |

## Convention

- Name files `S-YYYYMMDD-NN-<slug>.md`.
- Start from the previous session’s “next action” and verify it first.
- Record: objective, what was inspected, actions, verification evidence,
  decisions, unresolved items, and the exact next action.
- Add an index row when creating the record.
- Do not rewrite a closed session; add a follow-up record instead.
