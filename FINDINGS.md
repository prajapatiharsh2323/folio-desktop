# Part C — Code Review Findings

**Date:** 2026-11-09
**Scope:** release-blocking review of the restore, reader, notes/collections and
command-line paths listed for the stabilization pass. No High-severity defects
were found; five Medium issues were fixed and the remaining Low items are
recorded for later.

## Files reviewed

- `desktop/src/backup/backupService.ts`
- `desktop/src/backup/backupPaths.ts`
- `desktop/src/backup/zipArchive.ts`
- `desktop/src/reader/readiumEngine.ts`
- `desktop/src/reader/epubPublication.ts`
- `desktop/src/reader/navigation.ts`
- `desktop/src/screens/NotesScreen.tsx`
- `desktop/src/screens/CollectionsScreen.tsx`
- `desktop/src-tauri/src/open_files.rs`
- `desktop/src-tauri/src/lib.rs`

## Fixed — Medium

### C-01 · Notes writes could fail silently or submit twice
`desktop/src/screens/NotesScreen.tsx`

`handleEditSave` and `handleDelete` awaited storage with no `try/catch` and no
in-flight guard. A failed write produced an unhandled rejection, left the dialog
open with no explanation, and a second click could run the mutation again.

**Fix:** one `busy` flag guards both actions and disables the row and dialog
buttons; failures surface through the global toast host while the dialog keeps
the user's draft for retry.
**Tests:** `desktop/tests/notesScreen.test.tsx` (save failure keeps the draft,
retry succeeds, delete failure keeps the confirmation open).

### C-02 · A failed search-index build was cached forever
`desktop/src/reader/readiumEngine.ts`

`getSearchIndex()` stored the promise before building and never cleared it on
rejection. One transient failure (bad zip entry, allocation error) made every
later search in that book reject until the engine was destroyed.

**Fix:** the rejection path clears `searchIndexPromise` before rethrowing, so
the next query retries the build.
**Test:** `desktop/tests/reader.test.ts` — “retries a failed search index instead
of caching the rejection”.

### C-03 · Non-Unicode command-line arguments could panic startup
`desktop/src-tauri/src/lib.rs`

The first-instance launch path used `std::env::args()`, which panics when an
argument is not valid Unicode (possible from Explorer “Open with” on Windows).
A file association launch could therefore crash the app before the window
appeared.

**Fix:** `args_os()` plus a lossy conversion. Non-Unicode paths are skipped by
the openable-file check instead of crashing the process.
**Test:** none on this host; Rust toolchain and Windows are unavailable (see
“Unverified” below).

### C-04 · Percent-encoded EPUB container paths failed to open
`desktop/src/reader/epubPublication.ts`

The code required the literal `full-path` to exist in the zip before computing
the decoded path, so the decoded fallback on the next line was unreachable.
EPUBs whose `container.xml` percent-encodes the OPF name failed with
“EPUB container has no rootfile”.

**Fix:** the literal, decoded, and normalized lookups now share one fallback
chain.
**Test:** `desktop/tests/reader.test.ts` — “opens a package whose container
full-path is percent-encoded”.

### C-05 · Restore trusted per-entry sizes for the total budget
`desktop/src/backup/backupService.ts`

The central-directory check trusted declared uncompressed sizes, and
`readEntryData` only enforced the single-entry cap. An archive that under-declares
entry sizes could expand past `maxTotalBytes` while staging.

**Fix:** `extractToStaging` now sums the actual expanded bytes and aborts with
`too-large` before exceeding the restore budget.
**Test:** covered by the existing restore suite (normal archives unchanged); the
under-declared case cannot be produced by `fflate`, so it is enforced
defensively.

## Deferred — Low

| ID | Area | Note |
|---|---|---|
| C-L1 | `backupService.mergeLibrary` | Merge is incremental; a write failure mid-merge leaves a valid but partially merged library. Replace mode is transactional. |
| C-L2 | `backupService.recoverInterruptedRestore` | Rollbacks are ordered lexicographically; timestamps are fixed-width epoch milliseconds so this is correct today, but clock rollback can reorder them. |
| C-L3 | `epubPublication.rewriteHtml` | `url(...)` inside inline `style` attributes and CSS `@import "x.css"` are not rewritten, so those author assets may 404. |
| C-L4 | `epubPublication.AssetResolver` | Self-referential author CSS could recurse (`url(self.css)`); hostile-input hardening, not observed in real books. |
| C-L5 | `open_files.parse_args` | Non-Unicode file names are skipped rather than opened (the safer alternative to the crash above). |
| C-L6 | `CollectionsScreen` | Create/rename inputs do not submit on Enter and busy operations have no inline progress label; dialogs disable actions and report failures via toasts. |
| C-L7 | `readiumEngine` | One `frameDpr` is shared by all spine frames; mixed-DPI multi-monitor setups can make selection coordinates slightly off. |
| C-L8 | `readiumEngine.handleLocator` | Only `http(s)` links are surfaced; other external schemes fall through to the navigator. |

## Reviewed with no change needed

- **Restore swap/rollback:** data files stage and validate before the live root
  moves; a failed post-swap manifest check removes the new root and restores the
  rollback. Interrupted restores keep the rollback tree and never delete the
  live library to make room.
- **Backup path policy:** absolute/UNC/drive-letter, `..`, control characters,
  reserved Windows names, case-insensitive duplicates and over-deep paths are
  rejected before extraction.
- **Navigation coordinator:** page turns stay FIFO, absolute destinations
  coalesce, superseded moves resolve `ok` without surfacing a false failure, and
  the seek gate always clears.
- **Collections writes:** all create/rename/delete/add/remove/open paths share
  one busy gate, keep dialogs open on failure, and report through toasts.

## Verification (Linux)

- `./node_modules/.bin/tsc -b` — clean.
- `./node_modules/.bin/vitest run` — **304 passed / 41 files**.
- `./node_modules/.bin/vite build` — success (existing chunk-size warning only).

## Unverified

The Rust/Tauri build, `cargo test`, `cargo fmt --check`, real Windows open-with
behavior, and Narrator/display-scaling checks require a Windows host and remain
pending (see `MANUAL-TASKS.md`).
