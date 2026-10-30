# D-20261030-01 — Backup archives are transactional, self-describing, and never merge by file

**Status:** adopted 2026-10-30
**Task:** FT-007 (backup/restore hardening)
**Affects:** `desktop/src/backup/`, `desktop/src/screens/SettingsScreen.tsx`,
`desktop/src-tauri/src/commands/fs.rs`

## Context

The original export wrote every file under the library root into a ZIP with a
`schema: 1` `backup.json`; restore unzipped straight into the live library and,
in merge mode, skipped any path that already existed. Three problems:

1. **No verification.** A truncated or hand-edited ZIP was applied before any
   check, so a bad archive could destroy the library.
2. **File-level merge is not merge semantics.** "Skip existing path" leaves a
   document half-replaced (old `meta.json`, new EPUB), orphans folded files
   whose manifest entry vanished, and silently drops annotations for docs that
   were added.
3. **No rollback.** Replace deleted the root first; a failure mid-write left an
   empty library.

## Decision

1. **Backup format v2.** `backup.json` gains `appVersion`, `libraryId`,
   `docCount`, `fileCount`, `uncompressedBytes` in addition to
   `schema`/`app`/`createdAt`/`manifestSha256`. Schema-1 archives stay readable
   (a warning is shown and the archive is upgraded on restore).
2. **Export excludes derived data.** `index/` (rebuilt on restore), any
   `backup.json` already in the tree, `*.tmp`, and OS junk
   (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX/`). Restore never imports
   `backup.json` as library data.
3. **Validate before mutating.** Restore reads the ZIP central directory first
   and enforces entry count, per-entry size, total size, depth, path length and
   a metadata cap *before* expanding a single byte. Paths are normalized and
   rejected on traversal, absolute/drive/UNC prefixes, reserved Windows names,
   control characters, trailing dot/space, and case-only duplicates.
4. **Staged replace with rollback.** Extract to a sibling `restore-<uuid>` under
   the library workspace (same volume), validate manifest + `meta.json` +
   file sizes + SHA-256 + user JSON there, then swap:
   `library → library.rollback-<ts>`, `staging → library`. Any failure moves the
   rollback back. Success deletes the rollback.
5. **Startup recovery.** A two-rename swap can be interrupted. On launch, a
   missing or unparseable library root is repaired from the newest rollback
   (the unusable tree is preserved as `library.corrupt-<ts>`, never deleted);
   abandoned staging trees are removed.
6. **Merge is document-aware, never path-aware.** Match by doc id, then
   `contentHash`. Identical content is not duplicated; a same-id/different-hash
   doc is reported as a conflict and left alone. New docs are added through
   `LibraryManager.addDoc` (data files → `meta.json` → manifest last), with
   duplicate ids remapped and occupied slugs blanked so `addDoc` resolves them.
   Annotations merge by id with newest `updatedAt` wins; progress is newest-wins
   per doc; collections union membership and are re-dual-written onto
   `meta.json`; per-doc reading preferences are added only when missing; global
   settings stay local.
7. **`index/text/<docId>.json` is rebuilt after every restore** by re-parsing
   `reading/book.epub`, so search works immediately and backups stay small.

## Alternatives rejected

- **Keep file-level skip/overwrite merge.** Cannot express doc identity; causes
  inconsistent doc folders. Explicitly disallowed.
- **`unzipSync` the whole archive then validate.** A hostile or merely large
  archive exhausts memory before the first check.
- **Delete-then-write replace.** No rollback path.
- **Also back up `index/`.** Pure bloat; the index is derivable and could carry
  stale text from a previous edition.
- **ZIP64 support.** Deferred: current limits (2 GiB compressed / 8 GiB
  expanded) are below the ZIP64 range that matters here, and a 64-bit offset
  reader is extra untrusted-input surface. Archives above the limit are rejected
  with an actionable message.

## Consequences

- `FileStore` gained `move(from, to)`; Rust `fs_move` retries the rename
  (Windows antivirus/indexer locks) and `fs_delete` now propagates real I/O
  errors instead of swallowing them (still idempotent for `NotFound`).
- Restore needs free space roughly equal to the expanded archive; a preflight
  check reports the shortfall instead of failing mid-copy.
- Large libraries are still assembled in the webview (fflate), so export of a
  multi-gigabyte library will be memory-heavy even though it is now safe. A
  streaming/Rust-side writer is a candidate follow-up, not a correctness gap.
- Recovery can now quarantine a corrupt root; disk usage may temporarily
  include a `library.corrupt-*` folder that a human must delete.
