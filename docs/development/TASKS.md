# Task Board

Last updated: **2026-10-29** (bootstrap session `S-20261029-01`).
Statuses: `open`, `in-progress`, `blocked`, `done`. Keep this board limited to
active or known work; move narrative detail to session/audit records.

## Active work

| ID | Priority | Task | Status | Blocker / next action | Source |
|---|---|---|---|---|---|
| FT-001 | P1 | Taskbar jump list (“Open Folio” / “Import file…”) | open | Not started. Needs Windows shell integration + verification. | `REMAINING.md`; `.docs/09` §3 |
| FT-005 | P2 | Performance budget checks: cold open ≤ 1.2 s, page turn ≤ 80 ms, 200 highlights ≤ 400 ms | open | No harness yet. Define measurement method, then record results under `audits/results/`. | `.docs/04` §12 |
| FT-006 | P2 | Accessibility pass: focus rings, tab order, ARIA, contrast | open | Run a structured audit, file findings under `audits/ui-ux/`. | `.docs/03` §7 |

## Blocked work

| ID | Priority | Task | Status | Blocker | Source |
|---|---|---|---|---|---|
| FT-002 | P2 | OS display-scaling check at 100/125/150/200% | blocked | Requires real Windows hardware. | `REMAINING.md` |
| FT-003 | P1 | Drive sync end-to-end against a real Google account | blocked | Requires a Google OAuth **Desktop app** client ID and network; credentials are not in the repo. | `REMAINING.md`; `desktop/README.md` |
| FT-004 | P1 | Bundle the SQLite dictionary pack | blocked | Pack is a release asset built by `mobile/tools/build_dict.py`; the mobile tree is not in this repo. | `REMAINING.md`; `desktop/src-tauri/dict/README.md` |

## Completed in this bootstrap

| ID | Task | Status | Evidence |
|---|---|---|---|
| KB-001 | Establish persistent development knowledge base + recovery rules | done | [`I-20261029-01`](plans/implementations/I-20261029-01-development-knowledge-system.md), [`R-20261029-01`](audits/results/R-20261029-01-knowledge-bootstrap.md) |

## Verified state

- `desktop`: `tsc -b` clean, **107 Vitest tests / 11 files** passing,
  `vite build` successful on Linux.
- `cargo test` / `tauri:build` were **not** run here (Windows-only toolchain /
  missing webkit). Do not mark them verified.
- Git: clean `main` at `242778b` tracking `origin/main` at audit time.
- CI workflow exists; its latest remote run was not checked in this session.

## Selection guidance

1. Prefer unblocked P1 work (FT-001).
2. For blocked tasks, document the exact credential/asset/hardware needed and
   keep the code path unchanged unless the user supplies it.
3. Before starting any task, read the linked spec and re-verify the relevant
   code; then move it to `in-progress` and update `CURRENT_SESSION.md`.
