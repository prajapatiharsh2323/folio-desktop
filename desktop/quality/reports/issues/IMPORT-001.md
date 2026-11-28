# IMPORT-001 — Images in clipped HTML are missing from the generated reading EPUB

- Classification: confirmed defect
- Severity: P2 Medium
- Confidence: confirmed (deterministic builder inspection)
- Area: `src/import/clip/epubBuilder`, `src/import/importService`, `src/import/sanitize`
- Affected format/platform: HTML/TXT/clip imports; all platforms
- First observed: 2026-11-28 baseline audit
- Commit/build: `ed7a3a1`

## User impact
Any clipped article containing inline `data:` images renders with broken image
placeholders in the reader, even though the clean copy shows them.

## Preconditions
Import HTML (or a clip) whose source contains `<img src="data:image/...;base64,...">`.

## Reproduction steps
1. Import an HTML article with an inline base64 PNG.
2. Open the book. The cover/chapter text renders, images are broken.
3. Inspect `reading/book.epub`: `OEBPS/content.opf` lists `images/<hash>.png`,
   but the ZIP has no `OEBPS/images/` entries. `clean/images/<hash>.png` does
   exist on disk.

## Expected
The reading EPUB contains the referenced image files, so the reader paints them.

## Actual
Manifest advertises non-existent ZIP entries; Readium cannot resolve them.

## Evidence
- `src/import/sanitize.ts:174` rewrites data URIs to `images/<hash>.<ext>`.
- `src/import/importService.ts:124,127-130,332` writes bytes to `clean/images/`
  and passes only names to `buildEpub()`.
- `src/import/clip/epubBuilder.ts:71-80` creates OPF `<item>` entries for
  `images/<name>`; the zip `files` map at `:131-154` contains only mimetype,
  container, opf, nav and chapters; comment at `:120` claims images are
  "already placed under OEBPS/images/" (they are not).
- `tests/import.test.ts:284-303` only checks `clean/index.html` contains
  `images/`, so the gap is untested.

## Root cause
Image bytes are written to the clean edition's folder but never added to the
in-memory ZIP entry map consumed by `buildEpub()`.

## Proposed minimal fix
Extend `buildEpub()` input with the extracted image bytes (or a resolver from
`clean/images/`), and add one ZIP entry per image at `OEBPS/images/<name>`.
Keep deterministic mtime/compression options.

## Regression test
Import HTML with a data-URI PNG; unzip `reading/book.epub`; assert an
`OEBPS/images/<hash>.png` entry exists and its bytes equal the source image.

## Verification
- [x] Focused source trace
- [x] Red-phase test: generated EPUB had 0 `OEBPS/images/*` entries
- [x] Focused regression test after fix — `tests/import.test.ts` unzips
      `reading/book.epub`, asserts exactly one image entry and that its bytes
      match `clean/images/<name>`; 26/26 tests in the file pass
- [x] Full relevant suite / build / lint — 100 files / 785 tests, tsc 0,
      ESLint 0, Vite build success; byte-pinned `importBaseline` snapshots still
      pass (their fixtures contain no inline images)
- [ ] Manual EPUB reading with inline images — no native window on Linux
- [ ] Persistence/restart — not needed; no format/schema change

## Status / residual risk
**Fixed & verified (automated).** `buildEpub()` gained an optional `imageBytes`
map and writes each entry at `OEBPS/images/<name>` with the same deterministic
compression/mtime as the other EPUB entries. `importService` reuses the already
extracted bytes, so `clean/images/` and the reading EPUB now match. Only one
`buildEpub()` caller exists, so all clip paths are covered. Schema-1 meta and
backup format unchanged.
