# READ-009 — PDF “Page number” preference is a no-op control

- Classification: confirmed defect
- Severity: P3 Low
- Confidence: confirmed (repo-wide grep)
- Area: `src/components/PdfAppearancePanel`, `src/model/formatPrefs`
- Affected format/platform: PDF; all platforms
- First observed: 2026-11-28 baseline audit
- Commit/build: `ed7a3a1`

## User impact
The Appearance panel offers a **Page number** switch. Toggling it changes the
stored preference but nothing on screen: the dock still shows page x of y and
no page-number element is hidden or shown.

## Reproduction steps
1. Open a PDF, open Appearance, toggle “Page number” off.
2. Observe the dock/readout: unchanged.
3. Reopen the panel: switch reads off; behavior still unchanged.

## Expected
The toggle controls a visible page-number presentation (or is removed if the
feature is not implemented).

## Actual
No reader or dock code reads `PdfReaderPrefs.pageNumber`.

## Evidence
- `src/model/formatPrefs.ts:61` field, `:80` default `true`.
- `src/components/PdfAppearancePanel.tsx:274-279` writes the preference.
- Repo-wide grep for `pageNumber` finds only those two files plus an
  unrelated pdf.js adapter parameter (`pdfjsAdapter.ts:230-233`).

## Root cause
A preference was added to the panel and schema without a rendering consumer.

## Proposed minimal fix
Either wire the flag into `ReaderChrome`/`ReaderDock` page readout, or remove
the control and mark the field deprecated-inert (do not rename/remove schema-1
fields; this is an additive desktop-only pref, so check backup compatibility).

## Regression test
Render ReaderChrome with `pageNumber: false` and assert the page readout is
hidden; with `true`, assert it is visible. If the control is removed instead,
assert the panel no longer offers it.

## Verification
- [x] Focused source trace
- [ ] Focused regression test after fix
- [ ] Full relevant suite / build / lint
- [ ] Manual PDF appearance check

## Status / residual risk
Open. Decide intent with product owner before choosing wire vs remove.
