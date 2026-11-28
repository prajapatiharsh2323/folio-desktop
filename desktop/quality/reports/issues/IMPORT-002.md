# IMPORT-002 — “Refused” import after the document was already committed

- Classification: confirmed defect (promoted from suspected)
- Severity: P2 Medium
- Confidence: confirmed (failing-FileStore reproduction)
- Area: `src/import/importService`
- Affected format/platform: EPUB/HTML/TXT imports (indexed in-process); all platforms
- First observed: 2026-11-28 baseline audit (suspected); reproduced 2026-11-28
- Commit/build: `ed7a3a1`

## User impact
An I/O failure while writing the derived search index was reported as a
refused import, but the document had already been committed to the manifest.
Retrying showed a duplicate prompt for a book the user thought had failed.

## Reproduction steps
1. In a synthetic library, arm a `MemoryFileStore` to fail the first write to
   `index/text/*`.
2. Call `importFile(lm, "indexed.txt", bytes)`.
3. Observe `status: "refused"` while `lm.load()` still lists the document.

## Expected
A refused import leaves the library unchanged.

## Actual
Before the fix, `addDoc()` committed first and `writeIndex()` threw afterwards;
the catch block returned `refused` without rolling back.

## Evidence
- RED test in `tests/importReplace.test.ts` failed with 1 manifest doc after a
  refused result.
- Source (pre-fix): commit at `importService.ts:331`, index at `:333-337`,
  catch converting any error to `refused` at `:348-353`.

## Root cause
The derived index was written after the commit point, while the error contract
treats any throw as a failed (non-committed) import.

## Proposed / applied minimal fix
Write the in-process index before `addDoc()` in both `importFile()` and
`replaceDoc()`. PDF indexing is still enqueued after commit (the job re-checks
the manifest). A failure now occurs before anything is committed.

## Regression test
`tests/importReplace.test.ts`: fail only `/index/text/` writes, call
`importFile`, assert `refused` and that the library has no committed doc.

## Verification
- [x] Focused RED test reproduced the committed-after-refused state
- [x] Focused GREEN (2 tests in file, 43 across import/search focused suites)
- [x] Full gate — 101 files / 791 tests, tsc 0, ESLint 0, Vite build success
- [ ] Manual I/O-failure reproduction on Windows — not run

## Status / residual risk
**Fixed & verified (automated).** An orphan index file can remain if a commit
fails after the index write; it is derived data and is ignored/rebuilt by
`reconcileIndexes`, so it is not user-visible. No schema or backup change.
