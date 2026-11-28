# SEARCH-001 — Newly imported PDFs are absent from library search until restart

- Classification: confirmed defect
- Severity: P2 Medium
- Confidence: confirmed (deterministic code path; no runtime user-data test)
- Area: `src/import/importService`, `src/pdf/pdfIndexJob`, `src/shell/useBoot`
- Affected format/platform: PDF only; all platforms with PDF enabled
- First observed: 2026-11-28 baseline audit
- Commit/build: `ed7a3a1`

## User impact
A user imports a text-layer PDF and immediately searches the library: the book
is never found. Restarting the app "fixes" it, which makes the failure look
like search is unreliable.

## Preconditions
PDF feature enabled (default). Any library. Import via any path (picker,
folder, drag/drop, open-with) that reaches `importFile`.

## Reproduction steps
1. Import a PDF with a text layer.
2. Wait for the import toast; open Library search and query a word known to be
   in that PDF.
3. Observe no hit for the new document.
4. Restart the app; the same query now finds it.

## Expected
The imported PDF becomes searchable in the running session (queued index job
with visible progress is acceptable).

## Actual
No `index/text/<docId>.json` exists until the boot-time `reconcileIndexes()`
finds it on the next launch.

## Evidence
- `src/import/importService.ts:324-329` deliberately skips writing an index for
  PDFs; comment says "PDFs get their index from the background job".
- `src/pdf/pdfIndexJob.ts:115-138` defines `enqueueIndex()`; repo-wide grep
  finds its only call at `:225` inside `reconcileIndexes()`.
- `src/shell/useBoot.ts:103-112` is the only caller of `reconcileIndexes()`.
- `replaceDoc` (`importService.ts:392-396`) deletes the PDF index without
  re-enqueueing, so Replace has the same blind spot.
- `tests/pdfIndexJob.test.ts` covers the job when manually seeded/reconciled;
  no test covers the import → enqueue handoff.

## Root cause
The import pipeline hands PDF indexing to a background job, but nothing
enqueues that job at import time (or after Replace); the only producer is the
boot reconciliation pass.

## Proposed minimal fix
After a successful PDF commit in `importFile` and `replaceDoc`, call
`enqueueIndex(docId)` (fire-and-forget, idempotent via `isIndexQueued`), keeping
the commit-before-index ordering. Optionally surface the queued phase in the
library row.

## Regression test
Import a synthetic text PDF via `importFile`, refresh docs, then assert
`enqueueIndex` was called / an index job exists and that `buildLibraryIndex`
eventually contains the document's chapters.

## Verification
- [x] Focused source trace + repo-wide grep
- [x] Red-phase tests: two new tests in `tests/importPdf.test.ts` failed with
      `enqueueIndex` called 0 times
- [x] Focused regression test after fix — 7/7 tests in `importPdf.test.ts` pass;
      both fresh-import and `replaceDoc` paths assert `enqueueIndex(docId)`
- [x] Full relevant suite / build / lint — 100 files / 785 tests, tsc 0,
      ESLint 0, Vite build success
- [ ] Manual PDF import + immediate search — no native window on this Linux host
- [ ] Backup/restore path — unchanged by this fix

## Status / residual risk
**Fixed & verified (automated).** `importService` now imports `enqueueIndex`
and calls it after a successful PDF commit in both `importFile` and
`replaceDoc` (the latter still deletes the stale index first). The job remains
idempotent via `isIndexQueued()`, and boot-time `reconcileIndexes()` remains a
recovery net. Residual risk: SEARCH-002 (cache signature ignores index content)
can still hide the finished index from an already-open Library search panel;
that issue is separate and remains open.
