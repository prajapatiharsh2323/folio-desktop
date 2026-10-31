# S-20261031-01 — Accessibility pass (FT-006)

**Date:** 2026-10-31
**Task:** FT-006
**Status:** complete (code side); **committed and pushed**; screen-reader and
target-size items remain open in [`A-20261031-01`](../audits/ui-ux/A-20261031-01-accessibility.md)

## Objective

Continue after the FT-001 jump-list milestone (pushed 2026-10-30, CI green).
`TASKS.md` named FT-005 (perf budgets — needs real-runtime measurement) and
FT-006 (a11y audit) as the remaining code-side tasks; FT-006 is verifiable
from this host.

## What this session did

1. **Ran the §7 audit systematically** instead of spot-fixing:
   - Mechanical contrast: WCAG-2.1 ratio helpers over the token fixtures
     (same fixture that pins `tokens.css`), producing the full matrix for
     light + dark (see report).
   - Component/source sweep of every interactive element type: buttons,
     chips (single-select vs. toggle), dialogs/panels + `focusTrap.ts`,
     the progress scrubber (native `input[type=range]` ✓), book rows,
     live regions, decorative covers, icon-only buttons, reduced motion.
2. **Fixed the three concrete findings** (dialog focus restore, chip ARIA
   clash / missing Layout radiogroup, muted-as-functional-label CSS) — see
   [`A-20261031-01`](../audits/ui-ux/A-20261031-01-accessibility.md).
3. **Codified the contract in tests** so the audit can't silently regress:
   `tests/contrast.test.ts` (3 tests) and `tests/a11y.test.tsx` (3 tests,
   jsdom) for focus restore + chip semantics.
4. **Filed the non-fixable items honestly**: ≥48 px targets (spec §4/§7
   conflict; visual reflow risk without a Windows visual check),
   screen-reader announcements (needs real screen reader), and the spec's
   "secondary = 7:1" parenthetical (measured 5.09:1 — passes AA, still under
   the parenthetical claim).

## Decisions

- Measured contrast is now the durable artifact; screenshots/eyeballing are
  not required for the token pairs — the tests encode it.
- `folio-helper--muted` stays muted: it is explanatory copy ("Changes made
  inside a book stay with that book"), which §7 permits for non-functional
  text; functional labels moved to secondary.
- Grew test files rather than extending `shell.test.tsx` — the a11y/contrast
  concerns are orthogonal to the shell routing tests.

## Verification

```
./node_modules/.bin/tsc -b        # clean
./node_modules/.bin/vitest run    # 149 passed / 15 files (was 143/13)
./node_modules/.bin/vite build    # success
cargo fmt --all -- --check        # clean (no Rust changes)
```

## Unresolved

- A-UI-20261031-04 (target sizes ≥ 48 px) — design decision + Windows visual.
- A-UI-20261031-05 (screen-reader pass) — needs a real Windows session.
- Windows runtime confirmations for the fixed items (focus restore visuals).

## Exact next action

Nothing pending on Git after the push. Next code-side task: FT-005 (define
the perf measurement method + harness first, do not fabricate runtime
numbers); all other tasks need a Windows session or external credentials.
