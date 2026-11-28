# IMPORT-003 — Replace deleted the original edition before committing the new one

- Classification: confirmed defect (promoted from suspected)
- Severity: P1 High (data-loss risk on a mid-replace failure)
- Confidence: confirmed (failing-FileStore reproduction)
- Area: `src/import/importService`, `src/store/libraryManager`
- Affected format/platform: all formats on the Replace path; all platforms
- First observed: 2026-11-28 baseline audit (suspected); reproduced 2026-11-28
- Commit/build: `ed7a3a1`

## User impact
A write failure during Replace could leave the manifest pointing at a deleted
doc folder: the original book and cover were gone and the shelf row was broken.

## Reproduction steps
1. Seed a TXT document in a synthetic library; note `original/book.txt` bytes.
2. Arm a `MemoryFileStore` to fail the first write during the replacement.
3. Call `replaceDoc(lm, docId, "replacement.txt", bytes)`.
4. Observe `status: "refused"` and the original file missing (RED evidence:
   `ENOENT: /lib/docs/<slug>/original/book.txt`).

## Expected
A failed Replace keeps the previous edition fully readable and the manifest
consistent.

## Actual (before fix)
`importService.replaceDoc()` called `lm.deleteFolderOnly(oldDir)` before
`lm.addDoc()`, so any write failure lost the original bytes.

## Evidence
- RED test `tests/importReplace.test.ts` failed with ENOENT on the original file.
- Source (pre-fix): `importService.ts:385-387` delete then add.

## Root cause
Destructive deletion was performed before the commit point, with no rollback.

## Proposed / applied minimal fix
- Added `LibraryManager.moveFolder(from, to)` (thin wrapper over `FileStore.move`).
- `replaceDoc()` now renames the old folder to a staging path, writes derived
  index, commits via `addDoc()`, and deletes the staged original only after
  success. On a pre-commit failure it deletes the partial new folder and moves
  the staged original back; if rollback itself fails, it surfaces a clear
  refusal without exposing paths.
- Staging cleanup failure after a successful commit is logged, not reported as
  a Replace failure.

## Regression test
`tests/importReplace.test.ts`: fail the first write mid-Replace, then assert
`refused`, original bytes readable, and every manifest file path still exists.

## Verification
- [x] Focused RED test reproduced the lost original (ENOENT)
- [x] Focused GREEN (2 tests in file; 56 across import/backup focused suites)
- [x] Full gate — 101 files / 791 tests, tsc 0, ESLint 0, Vite build success
- [ ] Windows manual disk-full simulation — not run

## Status / residual risk
**Fixed & verified (automated).** The staging folder lives outside the doc's
normal path; a crash between rename and cleanup can leave an orphan folder not
referenced by the manifest, which recovery ignores and which is harmless.
Manifest ordering (written last) and Schema-1 data are unchanged.
