# A-20261031-01 — Accessibility audit (FT-006, `.docs/03` §7)

**Date:** 2026-10-31
**Scope shipped:** app shell, panels/dialogs, library rows, appearance panel,
cloud-sync section, reader chrome, tokens/stylesheet usage. Per `.docs/03` §7:
focus rings, tab order, interactive targets, text contrast, ARIA roles.
**Environment:** Linux host (frontend only, `jsdom` + source audit); no Windows
session — runtime-only checks (OS scaling reader behaviour) remain unverified.
**Result:** 3 findings fixed in code this pass, 2 unresolved findings
recorded, 1 spec-discrepancy note.

## Method

1. **Token contrast**: a WCAG 2.1 ratio implementation (`src/lib/contrast.ts`,
   pure) over `tests/fixtures/tokens.json` — the same fixture that pins
   `tokens.css` (`tokens.test.ts`). Encoded as
   `tests/contrast.test.ts` (screenshots-free, deterministic).
2. **Component/source audit** of every interactive component and its CSS:
   `FolioButton/FolioChip/FolioDialog/FolioPanel/FolioBookRow`, panels,
   scrubber, launcher/reader chrome, `focusTrap.ts`.
3. **Keyboard/A11y unit tests** (`tests/a11y.test.tsx`, jsdom) for the fixed
   semantics: dialog focus restore, chip radio semantics.

## Fixed in this pass

### A-UI-20261031-01 — Dialog/panel focus restore was a no-op

*Filing an open/close cycle returned focus nowhere because `prevActive` was
captured **after** `focusFirstIn()` had already moved focus into the surface
— the close handler then "restored" focus to the dialog itself, which
unmounts.* Fixed in `FolioPanel.tsx` and `FolioDialog.tsx` (capture **before**
`focusFirstIn`); asserted by `tests/a11y.test.tsx`
("restores focus to the … opener … on close"). **Status: fixed** (Linux
verified; visual confirmation on Windows pending — see Unresolved).

### A-UI-20261031-02 — Filter chips emitted clashing ARIA (radio + pressed)

*`FolioChip` always set `aria-pressed`; the Typeface chips additionally
passed `role="radio"` + `aria-checked`, so each button mixed toggle and radio
semantics — invalid ARIA per §7 "chips (radio group for filters)" and the
Layout chips had no radio semantics at all.* Fixed: `FolioChip` gained
`asRadio` (renders `role="radio"` + `aria-checked`, never
`aria-pressed`); AppearancePanel's Typeface and Layout chips are now proper
`radiogroup`s. Asserted in `tests/a11y.test.tsx`. **Status: fixed.**

### A-UI-20261031-03 — Muted text used for functional labels (contrast)

*Light `--folio-text-muted` `#87897F` is **3.11–3.55:1** on light surfaces
(§7 requires ≥ 4.5:1 and forbids muted for functional labels), yet it colored
the functional `.folio-section-header` and the book-row progress
percentage (`.folio-book-row__progress-label`).* Fixed: both now use
`--folio-text-secondary` (4.82–5.51:1 on light, 6.62–8.83:1 on dark),
encoded by `tests/contrast.test.ts`. `folio-helper--muted` remains only
for decorative helper copy; dark muted stays in that decorative role
(4.43:1 on `--folio-surface-raised` — below AA, documented in the test).
**Status: fixed.**

## Unresolved findings

### A-UI-20261031-04 — Interactive target sizes below §7's ≥ 48 px

*`.folio-iconbtn` is 40×40 px (base.css comment claims "≥40px target", an
older mobile-era sizing); `folio-chip` is a 32 px pill per `03` §4 — direct
contradiction with §7's "≥ 48 px target".* Raising them may reflow dense
headers that this Linux host cannot visually verify.
**Status: unresolved** — needs a decision + visual check on a Windows run
(before bump, locate/spec §4 vs §7 conflict).

### A-UI-20261031-05 — Screen-reader announcement of import progress/stream

*Live regions reviewed: import progress/result snackbar (`role="status"`),
sync failures (`role="alert"`), reader splash (`aria-live="polite") —
semantics look correct on source inspection, but whether announcements are
heard depends on real OS/app behavior.*
**Status: unresolved** — verify with a screen reader on Windows (not a Linux
testable item).

## Spec-discrepancy note (no code change)

`.docs/03` §7 claims light `--folio-text-secondary` reaches "7:1 ok" on the
light canvas; the measured value is **5.09:1** (`#676A61` on `#F7F6F1`) —
still well above AA (4.5), but the spec parenthetical is factually a claim
about 7:1 only, not about the token pair's actual ratio. No token change made; `tests/contrast.test.ts` replaces the
spec's unverified parenthetical with a measured expectation.

## Verification evidence (2026-10-31 Linux)

```
./node_modules/.bin/tsc -b        # clean
./node_modules/.bin/vitest run    # 149 tests / 15 files (was 143/13) —
                                  # +3 contrast, +3 a11y
./node_modules/.bin/vite build    # success
cargo fmt --all -- --check        # clean (frontend-only diff)
```

## Tab-order / keyboard sweep (no findings)

- Global `:focus-visible` ring (2 px accent, offset 2) exists and is not
  overridden anywhere interactive; the two `outline: none` rules apply to
  `role="dialog"` surfaces only (their focus is trapped inside; the surface
  itself is not in the tab sequence).
- Dialogs/panels are `role="dialog"` + `aria-modal`, Escape + backdrop close,
  tab-trap via the shared `focusTrap.ts`; the scrubber is a native
  `input[type=range]` with `aria-label` / `aria-valuetext` (§7 "slider").
- `prefers-reduced-motion` handled globally (`base.css`). Covers are
  decorative (`alt=""`); icon-only buttons carry `aria-label`s in the
  audited screens.
