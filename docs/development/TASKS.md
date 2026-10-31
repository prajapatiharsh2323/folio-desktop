# Task Board

Last updated: **2026-10-31** (session `S-20261031-03`, Google Drive sync removal — FT-003 feature retired).
Statuses: `open`, `in-progress`, `blocked`, `done`. Keep this board limited to
active or known work; move narrative detail to session/audit records.

## Active work

| ID | Priority | Task | Status | Blocker / next action | Source |
|---|---|---|---|---|---|
| FT-007 | P1 | Backup/restore safety: validated staged restore, document-aware merge, v2 archive | done (code) / blocked (Windows verification) | Linux checks green (`tsc -b`, 127 tests, `vite build`, `cargo fmt`). Windows swap/rollback + `cargo test` still unverified. | [I-20261030-01](plans/implementations/I-20261030-01-backup-restore-hardening.md) |
| FT-008 | P1 | Reader correctness: resume by `href`+progression+text anchor, relayout on resize, click/tap regions, annotation + bookmark anchoring | done (code) / blocked (Windows verification) | Linux checks green (`tsc -b`, 143 tests, `vite build`, `cargo fmt`). Locator codec + resume + decorations + click passthrough + teardown/prefs fixes done; real webview click/pagination behaviour needs Windows. Resize relayout deliberately stays with `EpubNavigator`. | [I-20261030-02](plans/implementations/I-20261030-02-reader-locator-correctness.md) |
| FT-001 | P1 | Taskbar jump list (“Open Folio” / “Import file…”) | done (code) / blocked (Windows runtime verification) | Linux checks green, including the first full-crate Windows-target compile (`cargo check --all-targets --target x86_64-pc-windows-gnu`, exit 0). COM `ICustomDestinationList` impl with the `windows` crate already in the tree; no new dependency. Runtime taskbar behaviour needs a real Windows run. | [I-20261030-03](plans/implementations/I-20261030-03-taskbar-jump-list.md); `.docs/09` §3 |
| FT-005 | P2 | Performance budget checks: cold open ≤ 1.2 s, page turn ≤ 80 ms, 200 highlights ≤ 400 ms | done (harness + method) / blocked (Windows measurements) | Deterministic Node harness (`desktop/scripts/perf.ts`, `pnpm perf`) with synthetic ~3 MB EPUB; Linux baseline: reader parse 316 ms, locator-decode-200 0.3 ms. Windows runtime measurements defined in `R-20261031-02` (cold open / page turn / decoration batch). | [`R-20261031-02`](audits/results/R-20261031-02-performance-method.md) |
| FT-006 | P2 | Accessibility pass: focus rings, tab order, ARIA, contrast | done (code) / partial (runtime) | Audit ran (Linux source + jsdom + token-fixture contrast): 3 findings fixed (dialog focus restore, chip radiogroup ARIA, muted-on-functional-labels), contrast + a11y unit tests added (149 tests / 15 files). Screen-reader pass + ≥48px target decision need a Windows session. | [A-20261031-01](audits/ui-ux/A-20261031-01-accessibility.md) |

## Blocked work

| ID | Priority | Task | Status | Blocker | Source |
|---|---|---|---|---|---|
| FT-002 | P2 | OS display-scaling check at 100/125/150/200% | blocked | Requires real Windows hardware. | `REMAINING.md` |
| FT-004 | P1 | Bundle the SQLite dictionary pack | blocked | Pack is a release asset built by `mobile/tools/build_dict.py`; the mobile tree is not in this repo. | `REMAINING.md`; `desktop/src-tauri/dict/README.md` |

## Completed

| ID | Task | Status | Evidence |
|---|---|---|---|
| KB-001 | Establish persistent development knowledge base + recovery rules | done | [`I-20261029-01`](plans/implementations/I-20261029-01-development-knowledge-system.md), [`R-20261029-01`](audits/results/R-20261029-01-knowledge-bootstrap.md) |
| FT-007 | Backup/restore hardening (Linux side) | done | [`I-20261030-01`](plans/implementations/I-20261030-01-backup-restore-hardening.md), [`S-20261030-01`](sessions/S-20261030-01-backup-restore-hardening.md) |
| FT-008 | Reader locator correctness (Linux side) | done | [`I-20261030-02`](plans/implementations/I-20261030-02-reader-locator-correctness.md), [`S-20261030-02`](sessions/S-20261030-02-reader-locator-correctness.md) |
| FT-001 | Taskbar jump list (Linux side) | done | [`I-20261030-03`](plans/implementations/I-20261030-03-taskbar-jump-list.md), [`S-20261030-03`](sessions/S-20261030-03-taskbar-jump-list.md) |
| FT-006 | Accessibility core pass (audit + fixes) | done | [`A-20261031-01`](audits/ui-ux/A-20261031-01-accessibility.md) |
| FT-005 | Perf harness + method + Linux baseline | done | [`R-20261031-02`](audits/results/R-20261031-02-performance-method.md), [`S-20261031-02`](sessions/S-20261031-02-perf-budget-harness.md) |
| FT-003 | Drive sync feature — retired with the whole feature (superseded by user decision) | removed | [D-20261031-03](decisions/D-20261031-03-google-drive-sync-removal.md) |

*(pushed: FT-007–FT-008 by user authorization on 2026-10-30; FT-001 code
`4cce075` / docs `a5e4a94` likewise)*

## Verified state

- `desktop`: `tsc -b` clean, **143 Vitest tests / 13 files** passing,
  `vite build` successful, `cargo fmt --all -- --check` clean; new
  Windows-target compile gate green (`cargo check --all-targets
  --target x86_64-pc-windows-gnu`, exit 0) (Linux, 2026-10-30).
- `cargo test` / `tauri:build` were **not** run here (Windows-only toolchain /
  missing webkit; the jump-list Rust tests first run in CI). Do not mark them
  verified.
- Committed and pushed to `origin/main` with user approval: `2dce770`
  (FT-007 backup hardening), `72d2a04` (FT-008 reader locator correctness),
  and FT-001 code (`4cce075`) + docs (`a5e4a94`). `main` and `origin/main`
  are in sync.
- **CI (`desktop-ci`, windows-latest) green for those pushes**:
  `cargo test --all-targets` **31 passed / 0 failed** (the FT-001
  `jumplist::tests` cases ran on the real Windows target), fmt/tsc/Vitest/
  `vite build` green, NSIS installer built. Runtime taskbar behaviour of the
  jump list still needs a real desktop session.

## Selection guidance

1. Push `main` for remote durability (needs explicit authorization), then
   continue **FT-001** (taskbar jump list) — it is the next unblocked P1.
2. Prefer unblocked P1 work over P2 polish.
3. For blocked tasks, document the exact credential/asset/hardware needed and
   keep the code path unchanged unless the user supplies it.
4. Before starting any task, read the linked spec and re-verify the relevant
   code; then move it to `in-progress` and update `CURRENT_SESSION.md`.
