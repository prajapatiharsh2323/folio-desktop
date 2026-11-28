# DATA-001 — Editing book details makes its backup unrestorable

- Classification: confirmed defect
- Severity: P1 High (backup/restore portability broken for any edited book)
- Confidence: confirmed (runtime reproduction)
- Area: `src/store/libraryManager`, `src/backup/backupService`
- Affected format/platform: all formats; all platforms
- First observed: 2026-11-28 baseline audit
- Commit/build: `ed7a3a1`, Vite/Vitest on Linux; no Tauri build

## User impact
After using **Edit details** on a book, creating a backup succeeds but restoring
that backup fails with a checksum error. Library data itself is intact, but the
user's disaster-recovery path is silently broken until the library is repaired
or reindexed.

## Preconditions
Any library with at least one document; no special settings or window size.

## Reproduction steps
1. In a disposable library, import one document (`lm.addDoc`).
2. Call `lm.updateMeta(docId, { title: "Renamed Book" })` (same path as the
   Library → Edit details dialog, `LibraryScreen.tsx:663-686`).
3. Read `manifest.json`; compare the `docs[0].files` entry for
   `docs/<slug>/meta.json` with the bytes now on disk.
4. `createBackup(fs, root)` then `restoreBackup({ fs, root: freshRoot, bytes, mode: "replace" })`.

## Expected
`meta.json`'s size/hash in the manifest matches its bytes; backup restores cleanly.

## Actual
Manifest keeps the pre-edit hash (size happened to match in the repro because
the title length was unchanged). Restore throws
`A file for “Renamed Book” failed its checksum.`

## Evidence
- Console/log: `AUDIT manifest entry sha matches actual: false`;
  `AUDIT backup inspection error: A file for “Renamed Book” failed its checksum.`
  (`/tmp/opencode/repro-data001-3.log`)
- Source: `src/store/libraryManager.ts:154-175` rewrites meta at `:173` and
  manifest at `:174` without refreshing `doc.files`; compare `:207-213`,
  `:249-263`, `:316-322` which do refresh it.
- Validation: `src/backup/backupService.ts:444-461` checks each `doc.files`
  entry's size and sha256 against staged bytes.
- Existing/new test: disposable `tests/__audit_tmp_repro.test.ts` (created and
  deleted during the audit) failed on the stale-hash assertion and proved the
  restore error. No permanent regression test exists yet.

## Root cause
`updateMeta()` updates document fields and `doc.updatedAt` but omits the
manifest file-entry refresh that every other `meta.json`-mutating mutator
performs, violating the "manifest is the commit point with correct file
hashes" invariant.

## Proposed minimal fix
Inside `updateMeta()`, after `await this.meta.write(...)` and before
`await this.manifest.write(manifest)`, recompute the `meta.json` entry via
`this.fileEntry(\`docs/${doc.slug}/meta.json\`)`, replace it in `doc.files`
(by path, as the sibling mutators do), and set `doc.updatedAt`.

## Regression test
`tests/libraryManager.test.ts`: addDoc → updateMeta(title) → assert the
manifest `meta.json` entry's sha256/size equal the actual file; then
`createBackup` → `restoreBackup(..., "replace")` succeeds.

## Verification
- [x] Focused repro (runtime, disposable test)
- [x] Red-phase permanent regression test: manifest size 581 vs actual 601,
      `vitest run tests/libraryManager.test.ts -t "DATA-001"` failed as expected
- [x] Focused regression test after fix — `tests/libraryManager.test.ts` now
      asserts size + sha256 match and that `createBackup` → `restoreBackup`
      into a fresh root succeeds (9/9 tests in the file pass)
- [x] Full relevant suite — 100 files / 782 tests passed
- [x] Build/typecheck/lint — `tsc -b` 0, `eslint . --max-warnings 0` 0,
      `vite build` success
- [ ] Manual EPUB / PDF — no native window on this Linux host
- [x] Persistence/backup path (repro + fixed restore assertion)
- [ ] Screenshot comparison — not applicable to a data-integrity fix

## Status / residual risk
**Fixed & verified (automated).** `updateMeta()` now recomputes the `meta.json`
manifest file entry (size + sha256) immediately after `meta.write()` and before
the manifest commit, matching `setDocCollections`, `mutateCollectionDocs`,
`deleteCollection`, `applyDocSide`'s caller, and the backup reconciliation path.
A repository-wide grep of all six `meta.write()` callers confirmed the other
five already refresh the entry or are followed by a manifest rebuild, so no
similar stale-hash path remains. Schema-1 fields, storage keys and backup
format are unchanged. No real user library was touched.
