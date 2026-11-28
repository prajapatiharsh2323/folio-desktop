# SEARCH-002 — Library search cache identity ignores index content

- Classification: confirmed defect (code-level); user-facing repro pending
- Severity: P2 Medium
- Confidence: probable (the missing invalidation is deterministic)
- Area: `src/lib/searchCache`, `src/screens/LibraryScreen`, `src/pdf/pdfIndexJob`,
  `src/backup/reindex`
- Affected format/platform: all formats; all platforms
- First observed: 2026-11-28 baseline audit
- Commit/build: `ed7a3a1`

## User impact
A search corpus built before a background PDF index job (or a restore reindex)
completes remains cached for the session. Searches can miss terms that are
present on disk until the library rows change (import/delete/retitle) or the
app restarts.

## Preconditions
An open Library screen with search used once, then an index file changes
without any doc id/title change. Easiest trigger: import a PDF (SEARCH-001)
while a search corpus is already cached; or restore/reindex in another path.

## Reproduction steps (code-derived; runtime repro pending)
1. Open Library search once so the index snapshot is cached.
2. Let `pdfIndexJob` write `index/text/<id>.json` for a PDF (or run
   `reindexDocs()`) without changing any row's id/title.
3. Reopen search and query a term unique to that index.
4. Observe the cached snapshot is reused; the term is not found.

## Expected
Any write to the index tree invalidates the cached corpus signature.

## Actual
`searchSignature()` hashes only `id` and `title` from rows.

## Evidence
- `src/lib/searchCache.ts:1-8` — signature from `id + title` only; comment
  lists "import, delete, retitle".
- `src/screens/LibraryScreen.tsx:149-153,203-207` — cached index returned on
  signature match; installed with a post-await guard.
- `src/pdf/pdfIndexJob.ts:193-196` writes index files without touching rows;
  `src/backup/reindex.ts:93-96` likewise.
- `tests/searchCache.test.ts:11-30` pins only add/remove/retitle cases.

## Root cause
The cache key models document identity, not corpus content; asynchronous index
producers can change content under a stable key.

## Proposed minimal fix
Include a cheap content-version input in the signature: e.g. manifest
`updatedAt`/file hashes, an index-generation counter bumped by every index
writer, or the set of `index/text/<id>.json` stat sizes/mtimes. Keep the
post-await signature guard.

## Regression test
Build an index, then write a new `index/text/<id>.json` with the same id/title
and a new term; assert the signature changes and the reopened search finds the
term. Add the same case for `reindexDocs()`.

## Verification
- [x] Focused source trace
- [x] RED-phase tests: signature test and import-generation test failed with
      `useSearchIndexGeneration` missing
- [x] Focused regression tests after fix — `tests/searchCache.test.ts` (3),
      `tests/import.test.ts` (27), `tests/pdfIndexJob.test.ts` (4),
      `tests/backupPdf.test.ts` (1) all pass; the import and PDF-job tests assert
      a generation bump after index writes
- [x] Full relevant suite / build / lint — 100 files / 789 tests, tsc 0,
      ESLint 0, Vite build success
- [ ] Manual PDF import + search — no native window on Linux
- [ ] Manual restore/reindex + search — no native window on Linux

## Status / residual risk
**Fixed & verified (automated).** `searchCache.ts` now owns a zustand
generation counter; `searchSignature()` includes it, and `LibraryScreen`
rebuilds when it changes. Every writer calls `bumpSearchIndexGeneration()`:
`importService.writeIndex` (EPUB/HTML/TXT), `pdfIndexJob`, and `backup/reindex`.
The post-await signature guard also picks up a mid-build bump. Schema-1,
index-file format and backup contract unchanged. Residual risk: a full
native-window manual check of "search after background PDF indexing" is still
outstanding on this Linux host.
