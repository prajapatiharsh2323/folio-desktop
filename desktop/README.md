# Folio Desktop

Tauri 2 + TypeScript/React desktop app for Folio. Specs live in `../.docs/`
(reference the prompt pack `08-vibe-coding-prompt-pack.md` for build phases).

## Phase 0 status (scaffold)

- **Done**: repo layout, Rust thin core command set, TypeScript `FileStore`
  (per-path mutex + atomic-write), path guard (TS + Rust) with unit tests,
  Vitest suite, window configuration (`Library`, min 720×560, default 1100×760).
- **Not yet**: Rust `cargo build` verification on Linux is blocked by missing
  system deps (webkit2gtk/gdk3). The path-guard module was verified standalone.
  Full-app build/launch must be validated on Windows (CI target: NSIS installer).

## Phase 1 status (design system + shell)

- **Done**: full token port (`src/styles/tokens.css`) — light+dark app palettes,
  cover tints, highlight swatches, spacing scale, sizing, radii, type scale,
  motion durations (03 §2–§4, §6). Token values are literal and asserted for
  equality against `tests/fixtures/tokens.json` in `tests/tokens.test.ts`.
- **Done**: theme switching (`src/theme/theme.ts`) — Light / Dark / System with
  OS-following via `prefers-color-scheme`; applied as `data-theme` on `<html>`.
- **Done**: components (`src/components/`): FolioButton, FolioChip, FolioRow,
  FolioPanel (right sheet 360/400px, focus-trapped, ESC/backdrop close),
  FolioDialog (+ confirm/cancel actions), FolioSectionHeader, FolioSettingsRow,
  FolioEmptyState, FolioBookRow, FolioIcons (24/20px inline SVG set).
- **Done**: single-window shell (`src/shell/`) — 232px left sidebar
  (Library / Collections / Notes / Settings), hidden in reader route; Zustand
  route stack; Library/Notes filter chips, empty states, Settings screen with
  App-appearance row wired to the theme store.
- **Note**: `.docs/design-system.md` and the `mobile/` reference tree are absent
  from this repo; tokens were ported from `03-ui-ux-spec.md` §2–§4/§6 (which
  carries the full token tables). If the design-system doc reappears, re-run the
  token-equality test against it.

## Phase 4 status (reader core)

- **Done**: Readium engine adapter (`src/reader/readiumEngine.ts`) over `EpubNavigator` —
  positions list generation (`positions.ts`), OPF/NCX/nav TOC + cover + layout parsing
  (`epubPublication.ts`), themes/typeface/scrub/scrim (`readerThemes.ts`), progress
  persistence with write gates + 60 s restore suppression (`progress.ts`), resume
  cascade (`resume.ts`), reading pace (`pace.ts`), chrome state machine (`chrome.ts`),
  keep-awake helper (`keepAwake.ts`).
- **Done**: reader route (`src/screens/ReaderScreen.tsx`) with splash (8 s failsafe) /
  error (Retry/Back), themed chrome (top bar + pillar + scrubber), appearance panel
  (360 px), TOC panel, keyboard matrix, keep-awake polling, debounced per-book
  prefs writes, progress/pace flush on exit.
- **Done**: reader styles (`src/styles/reader.css`), imported in `main.tsx`.
- **Tests**: 98 total green (pace, progress gates/restore, resume, chrome, themes,
  EPUB positions/TOC added in `tests/reader.test.ts`).
- **Deferred**: annotations (Phase 5), search (Phase 6), collections (Phase 7),
  backup/keyboard round-off (Phase 8), sync/dictionary/platform (Phases 9–11).
- **Blocked**: Tauri `cargo build` / `tauri:dev` cannot be validated on this Linux
  host (missing webkit2gtk/gdk3); Windows/CI remains the build target.

```bash
pnpm install
npx tsc -b            # typecheck
npx vitest run        # unit tests (15 passing)
cargo test            # (in src-tauri) — requires full toolchain + libs on Windows/Linux w/ webkit
pnpm tauri:dev        # needs a working desktop webview
pnpm tauri:build      # NSIS / installer
```

## Phase 2 status (stores, model & library data layer)

- **Done**: canonical schema-1 types (`src/model/types.ts`) — exact field names,
  optionality, and enum strings per `05` §1–§2, including the full `ReadingPrefs`
  shape with defaults and the dead `pdfZoom`/`maxWidth` fields; clamps + percent
  rounding helpers (`src/model/defaults.ts`), reader theme hex map.
- **Done**: ids & slugs (`src/model/ids.ts`) — `crypto.randomUUID`, mobile-parity
  slugify (lowercase/dash, `doc` fallback) with `-2` collision resolution, ISO-8601 UTC.
- **Done**: library layout (`src/lib/libraryPaths.ts`) — all path constants in TS;
  Rust stays path-free.
- **Done**: repos (`src/store/repos.ts`, `docMetaRepo.ts`) — Manifest (commit-point
  writer), DocMeta, Annotations, Progress, Collections, Prefs (global + doc overrides
  with `resolved()` merge and remove-only-override reset). Unknown keys preserved on
  patch-and-rewrite (`ignoreUnknownKeys` parity).
- **Done**: `LibraryManager` (`src/store/libraryManager.ts`) — addDoc (data files →
  meta → manifest LAST), deleteDoc cascade (folder → index → annotations/progress/
  collections/doc-settings → manifest last), dual-write `setDocCollections` /
  `mutateCollectionDocs` / deleteCollection, collection create/rename, process-wide
  write-batch lock (`src/lib/writeLock.ts`).
- **Tests** (41 total, green): byte-identical round-trip of the four schema-1 user
  files against checked-in compact fixtures, unknown-key survival, locked enum
  strings, slugify/collision, and every sticky rule incl. manifest-last ordering
  (asserted via an op-logging FileStore wrapper).

## Phase 3 status (import pipeline)

- **Done**: format detection & refusals (`src/import/fileDetector.ts`) — PDF
  `%PDF` magic refusal ("PDF is not supported"), EPUB zip + `container.xml`
  check, DRM scan of `META-INF/encryption.xml` (font-obfuscation-only allowed)
  and `rights.xml`, 50 MB cap, HTML/TXT sniffing, Devanagari language detect.
- **Done**: HTML sanitizer (`src/import/sanitize.ts`) — self-contained allow-list
  (editorial tag set), attribute policy (http(s) links only), drops
  scripts/styles/forms wholesale, extracts up to 40 inline data-URI images as
  hash-named `clean/images/*` files.
- **Done**: TXT/HTML importers (`articleImporters.ts`) — paragraph split,
  3–5 chapter split, language detect, word count.
- **Done**: EPUB importer (`epubImporter.ts`) — container → OPF → spine order →
  per-spine plain text; cover via EPUB3 `cover-image` property + EPUB2
  `meta[name=cover]` heuristic.
- **Done**: `EpubBuilder` (`clip/epubBuilder.ts`) — EPUB 3 with mimetype first
  stored uncompressed, deterministic bytes (fixed mtime), deterministic
  uuid-from-contentHash, `nav.xhtml`, TXT/HTML chapters.
- **Done**: import service (`importService.ts`) — dedup gate before the pipeline
  with Skip / Keep both / Replace (Replace = mobile `replaceDoc` parity: keeps the
  old id/slug/tags/collections, annotations + progress preserved), index
  `index/text/<docId>.json` generation, refusal copy surfaced.
- **Done**: recovery (`LibraryManager.detectRecovery`) — damaged docs (manifest
  entry w/o parsable meta) + interrupted imports (leftover folders), banner +
  review dialog with Remove/Delete.
- **Done**: library UI wiring — real rows (manifest + progress, "New"/percent,
  tinted fallback covers by contentHash seed), Import button (native dialog via
  `tauri-plugin-dialog`; browser `<input>` fallback), whole-window drag-and-drop
  (Tauri `onDragDropEvent` + HTML5 fallback), busy/success/error snackbar,
  duplicate + recovery dialogs.
- **Tests** (60 total, green): gates (PDF/DRM/rights/size), sanitizer
  (allow-list, 40-image cap), EpubBuilder determinism + valid-uuid derivation,
  TXT/HTML/EPUB end-to-end imports (incl. cover extraction EPUB3 + EPUB2),
  duplicate Skip/Keep-both/Replace with user-data preservation, replaceDoc,
  recovery detection.

## Phase 5 status (annotations)

- **Done**: selection → floating toolbar (4 swatches, Add note, Copy, Meaning placeholder);
  Annotation CRUD with quote/prefix32/suffix32/location/kind/color/note/timestamps;
  highlight painting on navigator ready; toggle-off on same color+quote; bookmarks via
  ⋯ and Ctrl+B; note editor dialog; Notes screen with filter pills, color rails,
  tap→open at annotation; missing-document rows still editable.
- **Done**: Quote card (P1) canvas render → Save PNG / Copy image.
- **Tests**: 98 total green.

## Phase 6 status (search)

- **Done**: `src/search/normalise.ts` + `src/search/miniSearch.ts`.
- **Done**: Library search panel and in-book search overlay.
- **Tests**: 98 total green.

## Phase 7 status (collections)

- **Done**: collections gallery (fan covers, counts, updated dates), detail view (rename, delete-with-confirm, add/remove members), create dialog.
- **Done**: Library filters (by collection) + sort (recent/title/author) + multi-select (select mode, delete, add to collection).
- **Tests**: 98 total green.

## Phase 8 status (settings, backup, keyboard)

- **Done**: Settings screen groups (appearance, reading, backup, storage, sync placeholder, about) with app theme row, default reading theme picker, storage sizes, open-folder button.
- **Done**: Backup export (zip) + restore (merge/replace) with progress dialog.
- **Done**: Keyboard wiring (app shortcuts, library "/", reader keys already in Phase 4).
- **Tests**: 98 total green.

## Phases 9–11 status (sync, dictionary, platform)

- **Phase 9**: sync merge semantics module (`src/sync/merge.ts`) — newest-wins, deletions never propagate, docId remap by contentHash. OAuth/Drive client deferred (requires Rust + network).
- **Phase 10**: dictionary headword normalizer (`src/dict/normalise.ts`) + Meaning card placeholder; Rust `dict_sqlite_query` remains a stub.
- **Phase 11**: platform polish deferred (file associations, single-instance, window-state restore need Rust/Tauri config). Keyboard shortcuts wired in Phase 8.
- **Tests**: 98 total green.

## Layout



- `src/`  — frontend (React, Zustand route stub, FileStore, path helpers).
- `src-tauri/` — thin Rust core: `fs_*`, `zip_*`, `sha256_file`,
  `open_external_url`, `prevent_display_sleep`, `dict_sqlite_query` (P2 stub).
  No Folio data-model logic lives here by design.
- `tests/` — Vitest suites (FileStore round-trip/atomicity, path guard).
