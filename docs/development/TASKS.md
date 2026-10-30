# Task Board

Last updated: **2026-10-30** (session `S-20261030-02`, reader locator correctness).
Statuses: `open`, `in-progress`, `blocked`, `done`. Keep this board limited to
active or known work; move narrative detail to session/audit records.

## Active work

| ID | Priority | Task | Status | Blocker / next action | Source |
|---|---|---|---|---|---|
| FT-007 | P1 | Backup/restore safety: validated staged restore, document-aware merge, v2 archive | done (code) / blocked (Windows verification) | Linux checks green (`tsc -b`, 127 tests, `vite build`, `cargo fmt`). Windows swap/rollback + `cargo test` still unverified. | [I-20261030-01](plans/implementations/I-20261030-01-backup-restore-hardening.md) |
| FT-008 | P1 | Reader correctness: resume by `href`+progression+text anchor, relayout on resize, click/tap regions, annotation + bookmark anchoring | done (code) / blocked (Windows verification) | Linux checks green (`tsc -b`, 143 tests, `vite build`, `cargo fmt`). Locator codec + resume + decorations + click passthrough + teardown/prefs fixes done; real webview click/pagination behaviour needs Windows. Resize relayout deliberately stays with `EpubNavigator`. | [I-20261030-02](plans/implementations/I-20261030-02-reader-locator-correctness.md) |
| FT-001 | P1 | Taskbar jump list (“Open Folio” / “Import file…”) | open | Not started. Needs Windows shell integration + verification. | `REMAINING.md`; `.docs/09` §3 |
| FT-005 | P2 | Performance budget checks: cold open ≤ 1.2 s, page turn ≤ 80 ms, 200 highlights ≤ 400 ms | open | No harness yet. Define measurement method, then record results under `audits/results/`. | `.docs/04` §12 |
| FT-006 | P2 | Accessibility pass: focus rings, tab order, ARIA, contrast | open | Run a structured audit, file findings under `audits/ui-ux/`. | `.docs/03` §7 |

## Blocked work

| ID | Priority | Task | Status | Blocker | Source |
|---|---|---|---|---|---|
| FT-002 | P2 | OS display-scaling check at 100/125/150/200% | blocked | Requires real Windows hardware. | `REMAINING.md` |
| FT-003 | P1 | Drive sync end-to-end against a real Google account | blocked | Requires a Google OAuth **Desktop app** client ID and network; credentials are not in the repo. | `REMAINING.md`; `desktop/README.md` |
| FT-004 | P1 | Bundle the SQLite dictionary pack | blocked | Pack is a release asset built by `mobile/tools/build_dict.py`; the mobile tree is not in this repo. | `REMAINING.md`; `desktop/src-tauri/dict/README.md` |

## Completed

| ID | Task | Status | Evidence |
|---|---|---|---|
| KB-001 | Establish persistent development knowledge base + recovery rules | done | [`I-20261029-01`](plans/implementations/I-20261029-01-development-knowledge-system.md), [`R-20261029-01`](audits/results/R-20261029-01-knowledge-bootstrap.md) |
| FT-007 | Backup/restore hardening (Linux side) | done | [`I-20261030-01`](plans/implementations/I-20261030-01-backup-restore-hardening.md), [`S-20261030-01`](sessions/S-20261030-01-backup-restore-hardening.md) |
| FT-008 | Reader locator correctness (Linux side) | done | [`I-20261030-02`](plans/implementations/I-20261030-02-reader-locator-correctness.md), [`S-20261030-02`](sessions/S-20261030-02-reader-locator-correctness.md) |

## Verified state

- `desktop`: `tsc -b` clean, **143 Vitest tests / 13 files** passing,
  `vite build` successful, `cargo fmt --all -- --check` clean (Linux,
  2026-10-30).
- `cargo test` / `tauri:build` were **not** run here (Windows-only toolchain /
  missing webkit). Do not mark them verified.
- Committed locally with user approval: `2dce770` (FT-007 backup hardening)
  and `72d2a04` (FT-008 reader locator correctness). **Not pushed** —
  `main` is ahead of `origin/main` by these plus the earlier knowledge-base
  commits.

## Selection guidance

1. Push `main` for remote durability (needs explicit authorization), then
   continue **FT-001** (taskbar jump list) — it is the next unblocked P1.
2. Prefer unblocked P1 work over P2 polish.
3. For blocked tasks, document the exact credential/asset/hardware needed and
   keep the code path unchanged unless the user supplies it.
4. Before starting any task, read the linked spec and re-verify the relevant
   code; then move it to `in-progress` and update `CURRENT_SESSION.md`.
