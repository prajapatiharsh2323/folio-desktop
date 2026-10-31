# Task Board

Last updated: **2026-10-31** (session `S-20261031-05` — audit repair batch 1:
collections routing, navigation controller, menu/controls, dictionary removed).
Statuses: `open`, `in-progress`, `blocked`, `done`. Keep this board limited to
active or known work; move narrative detail to session/audit records.

## Active work

| ID | Priority | Task | Status | Blocker / next action | Source |
|---|---|---|---|---|---|
| FT-009 | P0 | Collections repair: open books from a collection, restore origin route + selected collection on return, operation busy/error feedback, missing-member handling | done (code) / blocked (Windows verification) | Linux: `tsc -b`, 164 tests, `vite build` green. Needs a real desktop session: collections round-trip in the running app. | [I-20261031-05](plans/implementations/I-20261031-05-audit-repair-batch-1.md) |
| FT-010 | P0 | Reader navigation coordination: single `ReaderNavigationCoordinator` gates all navigation (clicks, keyboard, scrub, TOC, search); seek gate + superseded-request + failure notices | done (code) / blocked (Windows verification) | Linux unit-tested (9 cases). Real EPUB / webview click-zone + cleanup behaviour needs Windows. | [I-20261031-05](plans/implementations/I-20261031-05-audit-repair-batch-1.md) |
| FT-011 | P0 | Reader menu/controls: Escape ladder (menu→panel→search→selection), controlled More menu, no auto-hide under an open menu, shortcut/focus conflicts removed, live bookmark item, TOC match tolerance | done (code) / blocked (Windows verification) | jsdom-tested menu + TOC matching; keyboard/auto-hide timing needs Windows. | [I-20261031-05](plans/implementations/I-20261031-05-audit-repair-batch-1.md) |
| FT-012 | P1 | Reader UX (audit Phase 4): typography, reading width/margins, panels, progress; visual tuning | open | Deliberately deferred — visual changes are unverifiable without a Windows webview session. The in-book-search race (Phase 4) was fixed in this batch (request token). | [I-20261031-05](plans/implementations/I-20261031-05-audit-repair-batch-1.md) |
| FT-007 | P1 | Backup/restore safety: validated staged restore, document-aware merge, v2 archive | done (code) / blocked (Windows verification) | Linux checks green (`tsc -b`, 127 tests, `vite build`, `cargo fmt`). Windows swap/rollback + `cargo test` still unverified. | [I-20261030-01](plans/implementations/I-20261030-01-backup-restore-hardening.md) |
| FT-008 | P1 | Reader correctness: resume by `href`+progression+text anchor, relayout on resize, click/tap regions, annotation + bookmark anchoring | done (code) / blocked (Windows verification) | Linux checks green (`tsc -b`, 143 tests, `vite build`, `cargo fmt`). Locator codec + resume + decorations + click passthrough + teardown/prefs fixes done; real webview click/pagination behaviour needs Windows. Resize relayout deliberately stays with `EpubNavigator`. | [I-20261030-02](plans/implementations/I-20261030-02-reader-locator-correctness.md) |
| FT-001 | P1 | Taskbar jump list (“Open Folio” / “Import file…”) | done (code) / runtime startup verified | Windows run now works: the app launched and stayed up, so the `PKEY_Title` heap-corruption crash is fixed ([A-BUG-20261031-01](audits/bugs/A-BUG-20261031-01-jumplist-startup-crash.md)). Remaining: eyeball the pinned icon’s task list. | [I-20261030-03](plans/implementations/I-20261030-03-taskbar-jump-list.md); `.docs/09` §3 |
| FT-005 | P2 | Performance budget checks: cold open ≤ 1.2 s, page turn ≤ 80 ms, 200 highlights ≤ 400 ms | done (harness + method) / blocked (Windows measurements) | Deterministic Node harness (`desktop/scripts/perf.ts`, `pnpm perf`) with synthetic ~3 MB EPUB; Linux baseline: reader parse 316 ms, locator-decode-200 0.3 ms. Windows runtime measurements defined in `R-20261031-02` (cold open / page turn / decoration batch). | [`R-20261031-02`](audits/results/R-20261031-02-performance-method.md) |
| FT-006 | P2 | Accessibility pass: focus rings, tab order, ARIA, contrast | done (code) / partial (runtime) | Audit ran (Linux source + jsdom + token-fixture contrast): 3 findings fixed (dialog focus restore, chip radiogroup ARIA, muted-on-functional-labels), contrast + a11y unit tests added (149 tests / 15 files). Screen-reader pass + ≥48px target decision need a Windows session. | [A-20261031-01](audits/ui-ux/A-20261031-01-accessibility.md) |

## Blocked work

| ID | Priority | Task | Status | Blocker | Source |
|---|---|---|---|---|---|
| FT-002 | P2 | OS display-scaling check at 100/125/150/200% | blocked | Requires real Windows hardware. | `REMAINING.md` |

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
| A-BUG-20261031-01 | Jump-list `PKEY_Title` PROPVARIANT corrupted the heap; app closed on every launch | fixed | [`A-BUG-20261031-01`](audits/bugs/A-BUG-20261031-01-jumplist-startup-crash.md), [`S-20261031-04`](sessions/S-20261031-04-jumplist-startup-crash.md) |
| FT-004 | SQLite dictionary pack bundling — superseded by the full feature removal | removed | [D-20261031-05](decisions/D-20261031-05-dictionary-removal.md), [I-20261031-05](plans/implementations/I-20261031-05-audit-repair-batch-1.md) |

*(pushed: FT-007–FT-008 by user authorization on 2026-10-30; FT-001 code
`4cce075` / docs `a5e4a94` likewise)*

## Verified state

- **Linux verification (2026-10-31, `S-20261031-05`, this work):** `tsc -b`
  clean; **164 Vitest tests / 17 files** passing; `vite build` success;
  `cargo check --all-targets --target x86_64-pc-windows-gnu` exit 0 after the
  dictionary removal; `cargo fmt --all -- --check` clean. Tauri/NSIS build and
  runtime behaviours still need a Windows host.
- **Windows 11 26100 (2026-10-31, `S-20261031-04`)**: `tsc -b` clean,
  **140 Vitest tests / 14 files** passing, `vite build` success,
  `pnpm tauri build` (release + NSIS) success, `cargo fmt --all -- --check`
  clean, and the app launches and stays open (both the build-tree exe and the
  installed `%LOCALAPPDATA%\Folio` copy). The startup heap-corruption crash
  (`0xC0000374`) is fixed — see
  [A-BUG-20261031-01](audits/bugs/A-BUG-20261031-01-jumplist-startup-crash.md).
- `cargo test --all-targets` — **28 passed / 0 failed** (the 28 are what remains
  after the sync tests were deleted; the FT-001 `jumplist::tests` cases now run
  on a real Windows host).
- Earlier Linux verification (2026-10-30/31): same frontend results plus
  `cargo check --all-targets --target x86_64-pc-windows-gnu` exit 0.
- **History (kept):** committed and pushed with user approval — `2dce770`
  (FT-007), `72d2a04` (FT-008), FT-001 code `4cce075` + docs `a5e4a94`; CI
  (`desktop-ci`, windows-latest) was green for those pushes. The Drive-sync
  removal (`bba1d25`, `8b714bb`) and this fix are **not yet pushed**, so CI has
  not seen them.

## Selection guidance

1. Push `main` for remote durability (needs explicit authorization). The next
   unblocked items are the FT-001 visual taskbar check and the FT-005/FT-008
   Windows measurement passes.
2. Prefer unblocked P1 work over P2 polish.
3. For blocked tasks, document the exact credential/asset/hardware needed and
   keep the code path unchanged unless the user supplies it.
4. Before starting any task, read the linked spec and re-verify the relevant
   code; then move it to `in-progress` and update `CURRENT_SESSION.md`.
