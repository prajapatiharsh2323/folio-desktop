# READ-006 — No-copy PDFs still expose citation copy and share-as-image

- Classification: confirmed defect
- Severity: P2 Medium (rights/privacy gate bypass in the UI)
- Confidence: confirmed
- Area: `src/components/SelectionToolbar`, `src/screens/ReaderScreen`
- Affected format/platform: PDF with copy permission denied; all platforms
- First observed: 2026-11-28 baseline audit
- Commit/build: `ed7a3a1`

## User impact
A PDF whose permissions forbid copying still offers two one-click ways to
extract the selected text: **Copy with citation** (clipboard) and **Share as
image** (QuoteCard). Only the plain **Copy** button is disabled.

## Preconditions
Open a PDF whose `capabilities.noCopy` is true (permission report from pdf.js);
select some text.

## Reproduction steps
1. Open a no-copy PDF and select text.
2. Observe the selection toolbar: Copy is disabled, but “Copy with citation”
   and “Share as image” are enabled.
3. Click either; selected text is copied/rendered.

## Expected
Every text-extraction action is disabled or hidden for a no-copy document
(the app explicitly decided not to block reading itself).

## Actual
`copyDisabled` is threaded only into one button.

## Evidence
- `src/components/SelectionToolbar.tsx:70-79` — Copy uses `disabled={copyDisabled}`.
- `:80-97` — Copy with citation and Share as image have no `copyDisabled`
  guard.
- `src/screens/ReaderScreen.tsx:1224` — `copyDisabled={!!quoteSelection && !noCopy}`;
  `:1420-1421` passes it; `noCopy` from `capabilities?.noCopy` at `:1116`.
- The More-menu share item is correctly gated (`:1224`), showing the intended
  contract.

## Root cause
The D2 no-copy capability was applied to the original Copy button and to the
menu, then new extraction actions were added without extending the gate.

## Proposed minimal fix
In `SelectionToolbar`, apply `copyDisabled` to `onCopyCitation` and `onShare`
buttons as well (disable, update `title`/`aria-label` to explain why). Keep
highlighting and note actions available — those are annotations, not extraction.

## Regression test
Render `SelectionToolbar` with `copyDisabled` and assert all three extraction
buttons have `disabled`; assert highlight/note buttons remain enabled. Add a
ReaderScreen-level test with `capabilities.noCopy=true`.

## Verification
- [x] Focused source trace
- [x] RED-phase test showed Copy with citation / Share still enabled
- [x] Focused regression test after fix — `tests/citationShare.test.tsx`
      asserts all three extraction buttons disabled while highlight/note stay
      enabled; 4/4 tests in the file pass
- [x] Full relevant suite / build / lint — 100 files / 789 tests, tsc 0,
      ESLint 0, Vite build success
- [ ] Manual PDF (no-copy fixture) — no native window on Linux
- [ ] Keyboard/accessibility (disabled announcements) — not run

## Status / residual risk
**Fixed & verified (automated).** `SelectionToolbar` now applies
`copyDisabled` to Copy, Copy with citation and Share as image, with explanatory
titles. Highlighting and note-taking remain available (annotations, not text
extraction). This is a UI rights gate, not a cryptographic DRM boundary.
