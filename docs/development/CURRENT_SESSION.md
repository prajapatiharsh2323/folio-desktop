# Current Session Checkpoint

**Session:** `S-20261031-01` — accessibility pass (FT-006)
**Updated:** 2026-10-31
**Status:** FT-006 core audit + fixes **implemented and pushed**; FT-001–008
all committed and CI-green on `origin/main`. `session.json` (previous
transcript dump) remains the only untracked file.

## Verified current state

- Branch `main` in sync with `origin/main`; all FT work committed and pushed.
- Linux verification (2026-10-31, after FT-006 changes), from `desktop/`:
  - `./node_modules/.bin/tsc -b` — clean
  - `./node_modules/.bin/vitest run` — **149 tests / 15 files** passing
    (+3 contrast, +3 a11y vs. 143/13 before)
  - `./node_modules/.bin/vite build` — success
  - `cd src-tauri && cargo fmt --all -- --check` — clean
- **CI `desktop-ci` green** for the FT-001 push (Windows runner):
  `cargo test --all-targets` **31 passed / 0 failed** (the two new
  `jumplist::tests` ran), NSIS installer built.
- Not run here: `cargo test` locally (webkit; CI covers it), any Windows
  desktop session (jump-list runtime behaviour, focus-restore visuals,
  screen-reader pass, ≥48 px target decision).

## Completed in this session (FT-006 audit, [`A-20261031-01`](audits/ui-ux/A-20261031-01-accessibility.md))

1. **Contrast made mechanical**: new pure `src/lib/contrast.ts` (WCAG 2.1
   ratio) + `tests/contrast.test.ts` over the pinned `tokens.json` fixture —
   approved pairs must be ≥ 4.5:1 on both themes; muted failures are encoded
   as documented negative cases.
2. **Fixed A-UI-20261031-01** — `FolioPanel`/`FolioDialog` captured
   `prevActive` *after* `focusFirstIn` had moved focus, so close never
   restored focus outside; now captured before. Asserted by
   `tests/a11y.test.tsx`.
3. **Fixed A-UI-20261031-02** — `FolioChip` always emitted `aria-pressed`
   even when callers added `role="radio"`; new `asRadio` prop renders
   `role="radio"` + `aria-checked` without the clash. Typeface **and now
   Layout** chips are proper `radiogroup`s.
4. **Fixed A-UI-20261031-03** — `.folio-section-header` and
   `.folio-book-row__progress-label` switched from 3.1–3.5:1 muted to
   `--folio-text-secondary` (§7: muted never for functional labels).
5. **Recorded unresolved**: interactive targets 40/32 px vs. §7's ≥ 48 px
   (spec §4/§7 conflict + needs visual verify), screen-reader live-region
   pass, and the `.docs/03` §7 "7:1" parenthetical discrepancy (measured
   5.09:1) as a spec note.
6. Audits indexes (`audits/README.md`, `audits/ui-ux/README.md`),
   `TASKS.md` updated; `S-20261031-01` session record written.

## Open work

See [`TASKS.md`](TASKS.md). Remaining: FT-005 perf budgets (no harness yet),
Windows-runtime verifications (jump list, reader, focus visuals,
screen reader, scaling), FT-003 Drive E2E, FT-004 dictionary pack.

## Exact next action

1. Push/commit handled this session. Remaining approval-free code-side task:
   FT-005 measurement-method definition; everything else needs a Windows
   session or external credentials.
