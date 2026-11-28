# READ-018 — PDF reading never reaches 100%, so the end-of-book card is unreachable

- Classification: confirmed defect
- Severity: P2 Medium
- Confidence: confirmed (deterministic math + code path)
- Area: `src/pdf/pdfLayout`, `src/screens/ReaderScreen`
- Affected format/platform: PDF; all platforms
- First observed: 2026-11-28 baseline audit
- Commit/build: `ed7a3a1`

## User impact
Reading a PDF to the last page leaves the dock at e.g. 95% (10-page book),
the "time left" pill never clears, and the “You've finished this book” card
never appears. Only scrubbing the dock all the way to the right can raise it.

## Preconditions
Any PDF, paginated mode. No special preferences.

## Reproduction steps
1. Open a 10-page PDF and read/advance to the last page.
2. Observe the dock percent and the absence of the end-of-book card.
3. Compare with an EPUB read to its last page (card appears).

## Expected
Reaching the final page means 100% progress; completion affordance appears.

## Actual
`progressionForPage(page, count) = (page - 0.5)/count`, so the last page
yields `1 - 0.5/count` (< 1). `ReaderScreen` requires `percent >= 100` for
`finished`, which gates the end card and completion display.

## Evidence
- `src/pdf/pdfLayout.ts:301-306` and its pinned test
  `tests/pdfLayout.test.ts:187-188` (center-based progression, intentional for
  scrub mapping).
- `src/pdf/pdfSession.ts:368` returns that progression as the locator value.
- `useReaderEngine.ts:229` converts to percent; `ReaderScreen.tsx:1052-1063`
  uses `percent >= 100`; `ReaderChrome` receives `finished`.
- `pageForProgression()` at `pdfLayout.ts:308-313` maps 1.0 back to the last
  page, so the scratch path works — the asymmetry is in the outward value.

## Root cause
A scrub-centric progression function is reused as the user-facing completion
signal; center-of-last-page can never equal the end of the document.

## Proposed minimal fix
Keep center-based mapping for scrubbing, but clamp/emit 1 (100%) when the
session is on the last page (and 0 on the first page for symmetry), or have
`ReaderScreen` treat "last page + at page end" as finished for PDFs. Preserve
the existing `pdfLayout.test.ts` contract by adding a separate helper rather
than changing `progressionForPage` semantics used for scrubbing.

## Regression test
With a 10-page PDF, assert the last page's locator progression is 1 (or that
`finished` becomes true after advancing to the last page); assert scrubbing to
50% still selects the middle page.

## Verification
- [x] Focused source trace
- [x] RED-phase test showed last-page progression 0.95 instead of 1
- [x] Focused regression test after fix — `tests/pdfSession.test.ts` asserts
      page 10 of 10 reports 1 and `goToProgression(1)` round-trips; 13/13 pass.
      The existing mid-book assertion `(4-0.5)/10` and all 17
      `pdfLayout.test.ts` cases still pass, so scrub mapping is unchanged.
- [x] Full relevant suite / build / lint — 100 files / 789 tests, tsc 0,
      ESLint 0, Vite build success
- [ ] Manual PDF completion flow — no native window on Linux
- [ ] EPUB completion flow — unchanged code path, not re-checked manually

## Status / residual risk
**Fixed & verified (automated).** `PdfSession.progression()` returns 1 when
`_page >= _pageCount`; center-based `progressionForPage()` is untouched for
scrubbing and mid-book readouts. `ReaderScreen` therefore raises `finished`
and the end-of-book card when the user reaches the last page. No schema or
progress-format change.
