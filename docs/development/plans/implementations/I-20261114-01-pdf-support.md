# I-20261114-01 — PDF Support (Folio Desktop)

**Plan:** "Folio PDF Support: Implementation Plan" (13 Nov 2026, prepared for an
AI coding agent; companion to the 2026-11-12 production-readiness report items
E1, E3, R1, R13, R16, F1).
**Worktree:** `~/.local/share/opencode/worktree/8cca39/pdf-support`
(branch from `main` @ `380e6b3`) — isolated because session `S-20261113-01`
left uncommitted Step 2.1 work in the main checkout and Step 2.2 (R4) as its
next action; both touch `ReaderScreen.tsx`/`navigation.ts`, which this effort
also edits.
**Session record:** [`S-20261114-01`](../../sessions/S-20261114-01-pdf-support.md)

## Decisions adopted (user-confirmed 2026-11-14)

All recommended defaults from plan §1:

- **D1** desktop-only; restore summary gains "N PDFs may not open on mobile".
- **D2** honour the no-copy permission flag by disabling Copy / Share-as-image
  for that document (reading never blocked). Legal sign-off still pending.
- **D3** PDFs < 20 pages are `kind: "article"`, otherwise `"book"`; the Library
  always shows a separate PDF badge.
- **D4** PDF file association registered as `rank: "Alternate"`, never default.
- **D5** 300 MB PDF cap — only after the raw-bytes IPC change (report E1)
  lands; until then PDFs stay capped at 50 MB.
  **E1 gate status: not landed — PDF imports therefore capped at
  `MAX_IMPORT_BYTES` (50 MB) until E1 or an equivalent raw-bytes IPC path
  ships.**

## Phase 0 — groundwork (no behaviour change) ✅ done

Verified 2026-11-14 in the worktree. Baseline before work: `tsc -b` clean,
**331 Vitest tests / 45 files** (HEAD = committed `S-20261113-01` Phase 1 +
Step 2.0), `vite build` green.

1. **`src/lib/features.ts`** — `FEATURES.pdf: false` + `featureEnabled()`.
   Every PDF code path must consult it; off ⇒ today's behaviour exactly,
   including the "PDF is not supported" refusal.
2. **`importService.ts` pure refactor** — extracted
   `export interface PipelineResult` (was the inline `runPipeline` return) and
   `export function buildMetaFiles(p)`; generalised `filesMapFor(p)` to
   `readingPath`/`readingBytes` (today always `reading/book.epub`; the PDF
   branch later returns `reading/book.pdf` + `originalBytes: null`).
   `importFile` and `replaceDoc` now share one `meta.files` builder.
3. **Engine seam additions** (`src/reader/ReaderEngine.ts`, all optional so
   Readium compiles unchanged): `ReaderLocator.page/pageCount/pageLabel`,
   `ReaderCapabilities`, `ReaderPageInfo`, `CreateEngineArgs`, and optional
   engine members `capabilities`, `pageInfo()`, `setZoom()`, `zoomBy()`,
   `getZoom()`, `scrollStep()`, `clearSelection()`, `onDecorationClick()`,
   `onProgress()`. `ReaderEngineFactory` kept as a deprecated alias.
4. **`src/reader/engineFactory.ts`** — `createEngine({format, readingBytes,
prefs, initial, pageTextProvider?})`: EPUB → unchanged
   `createReadiumEngine`; PDF → throws "PDF support is turned off" while the
   flag is off (reached only after a rollback with PDFs already in library).
5. **`src/store/readerStore.ts`** — `ReaderDoc.format: "epub" | "pdf"` +
   `ReaderDoc.readingBytes`; `epubBytes` kept as a deprecated alias of the
   same array. `load()` refuses `sourceFormat === "pdf"` with
   "PDF support is turned off" while the flag is off.
6. **`useReaderEngine.ts`** — engine creation switched to `createEngine`
   (reads `doc.format` / `doc.readingBytes`); everything else untouched.
7. **`AppearancePanel`** — optional `capabilities?: ReaderCapabilities` prop
   (undefined ⇒ today's EPUB panel exactly). PDF sections come in Phase 2.
8. **`ReaderDock`** — optional `pageInfo` + `step` props; absent ⇒ identical
   render (EPUB). Present ⇒ "Page X of Y" beside the percent,
   `aria-valuetext="Page X of Y"`, slider `step` prop.

**Baseline protection:** `tests/importBaseline.test.ts` (5 tests) —
EPUB/HTML/TXT import snapshots pin the exact `meta.json` (uuid/timestamps/
contentHash masked because fflate's `zipSync` embeds zip timestamps) and
`meta.files` shape, plus direct `buildMetaFiles`/`filesMapFor` unit contracts
pre-dating the refactor.

**Gates:** `tsc -b` clean; **Vitest 336 / 336 (46 files)** (331 pre-existing
passing unmodified + 5 new); `vite build` green (pre-existing chunk-size
warning only); ESLint 0/0 on all touched files; Prettier clean. Rust untouched
(no `cargo` gate needed). Manual EPUB smoke test pending Windows (runtime).

**Not done here:** `TASKS.md` / `CURRENT_SESSION.md` board updates were
deliberately deferred to merge time — the other agent (`S-20261113-01`,
Step 2.1 uncommitted) actively edits both files in the main checkout; this
record + the session record carry the status instead.

## Phase 1 — import & storage ✅ done

Verified 2026-11-14 in the worktree. Gates: `tsc -b` clean; **Vitest 359 /
359 (50 files)** (336 pre-existing passing unmodified + 23 new); `vite build`
green (pre-existing chunk-size warning only; `vite-plugin-static-copy` copies
cmaps/standard_fonts/wasm to `dist/pdfjs/`); ESLint 0/0; Prettier clean;
`cargo test -p foliocore --all-targets` 14 passed (main-crate `open_files`
tests pending Windows — webkit2gtk).

1. **pdfjs-dist 6.5.438, exact pin** (patched ≥ 6.2.108 for CVE-2026-16633;
   6.x has no `eval` at all, so CVE-2024-4367 is structurally fixed —
   `enableScripting` lives only in layers Folio never instantiates).
   `src/pdf/pdfjsAdapter.ts` is the only module allowed to import it; worker
   via `?url` asset; legacy build in Node; aborts via `task.destroy()` (6.x
   `getDocument` has no `signal` option); `classifyPdfError` maps
   PasswordException/InvalidPDFException to the plan's codes.
2. **Build + CSP**: `vite.config.ts` static-copies pdf.js data assets;
   `tauri.conf.json` csp/devCsp add `worker-src 'self'` +
   `'wasm-unsafe-eval'` (script-src). Release-build CSP verification pending
   Windows.
3. **`desktop/THIRD-PARTY-NOTICES.md`** — pdfjs-dist Apache-2.0 + bundled
   cmaps/fonts/wasm licences, Readium/fflate/zustand/react notices.
4. **`fileDetector.ts`** — flag-gated PDF branch: `hasPdfMagic` anywhere in
   the first 1 KB (flag off keeps the legacy byte-0-only refusal exactly),
   `MAX_PDF_BYTES` (300 MB, D5) + `pdfSizeCap()` returning 50 MB until E1,
   `tooLargeMessage` with actual sizes, `COPY.encrypted/invalidPdf/noPages`,
   `SourceFormatDetect` + `"pdf"`, `ImportError` + `"encrypted"`; `stem()`
   moved here as canonical (importService re-exports for compat, avoids the
   import cycle).
5. **`parsePdf.ts`** — import-time parse: info dict + junk-title filter +
   XMP dc:title/dc:creator fallback, outline walk (cycle guard, 5,000 cap,
   dedup by page, URI actions skipped), page-1 JPEG cover ≤480 px q0.82
   (browser-only; Node returns null), first-20-pages sample →
   `searchable` (< 20 chars/page ⇒ scanned), `estimatedWordCount`,
   `language`; byte copy before pdf.js detaches the buffer; 30 s abort
   timeout; always `destroy()` in `finally`.
6. **`importService.ts` PDF branch** — `runPdfPipeline`: one copy
   `reading/book.pdf`, `original: null` (backup validation only needs
   `files.reading`); D3 kind (< 20 pages ⇒ `article`); `searchable` from
   parse; `wordCount = estimatedWordCount`; chapters = flattened outline or
   ≤ 40 synthetic "Pages a–b" groups (href `page-N`); **no import-time
   index** — the background job owns it; Replace drops the stale index file.
7. **`pdfIndexJob.ts`** — serial queue (`enqueueIndex`/`cancelIndex`/
   `isIndexQueued`/`indexQueueIdle`), per-run cancel tokens (cancel kills
   only the current run; re-enqueue starts fresh), jobs register
   synchronously as `phase: "queued"` then run with progress
   (`useIndexJobs` zustand store); schema-1 `index/text/<docId>.json` with
   one chapter per page (`href: page-N`, outline titles where present);
   manifest re-check before the atomic write; `finally` always clears the
   job entry. `reconcileIndexes()` enqueues every searchable PDF whose index
   is missing; wired into `useBoot.ts` after restore recovery.
8. **`backup/reindex.ts` PDF branch** — restore/reindex rebuilds page-text
   indexes from `reading/book.pdf` via the same extractor.
9. **Library badge** — `LibraryRow.format` (from `meta.sourceFormat`),
   `FolioBookRow` "PDF" badge (subtle pill, 1 px border, in the accessible
   name "Open {title}, PDF"), `LibraryScreen` passes `row.format`.
10. **Search** — `buildSearchIndex` in LibraryScreen reads index hrefs
    generically; PDF `page-N` hit locations flow through unchanged
    (reader-side resolution lands in Phase 2).
11. **Pickers/associations/copy** — browser `input.accept` + Rust
    `BOOK_EXTENSIONS`/`OPENABLE_EXTENSIONS` + `tauri.conf.json`
    `fileAssociations` PDF entry (`role: "Viewer"`, `rank: "Alternate"`,
    D4); flag-off builds still refuse PDFs at the TS import gate with the
    mobile-parity copy, so Rust accepting the path is safe. Empty state,
    onboarding drop zone, tour step 1 mention PDFs. Import button labels
    were already generic.
12. **Backup (D1)** — `inspectBackup` counts `sourceFormat: "pdf"` per-doc
    meta.json entries and warns "Includes N PDF documents; Folio Mobile may
    not open them yet."

**Tests added:** `tests/parsePdf.test.ts` (10, node env, real pdf.js),
`tests/importPdf.test.ts` (5, node env, end-to-end pipeline: files/meta/D3/
outline chapters/scanned/duplicate+replace/encrypted contract),
`tests/pdfIndexJob.test.ts` (4), `tests/backupPdf.test.ts` (1, archive →
D1 warning → restore → byte-identical reading copy → reindex rebuilt
page-text index), `tests/import.test.ts` flag-off refusal parametrised +
PDF gate cases. Fixture generator `src/perf/synthPdf.ts` (simple/nested/
broken outlines, mixed sizes, rotation, scanned) verified against real
pdf.js in-repo.

**Pending Windows:** installer build, release CSP, worker/WASM load proof,
`open_files.rs` test run (extension list updated + tests extended, compiles
pending webkit2gtk), manual EPUB + PDF smoke test.

**Not done here:** `TASKS.md` / `CURRENT_SESSION.md` board updates were
deliberately deferred to merge time — the other agent (`S-20261113-01`,
Step 2.1 uncommitted) actively edits both files in the main checkout; this
record + the session record carry the status instead.

## Phase 2 — reader MVP ✅ done

Verified 2026-11-14 in the worktree. Gates: `tsc -b` clean; **Vitest 396 /
396 (53 files)** (359 pre-existing passing unmodified + 37 new); `vite build`
green (pre-existing chunk-size warning only); ESLint 0/0; Prettier clean.
Manual EPUB + PDF smoke test pending Windows.

1. **`src/pdf/pdfLayout.ts`** — pure layout math (no DOM, no pdf.js):
   `clampZoom` (0.25–4), `resolveScale` (fit-width/fit-page/absolute ×
   `BASE_SCALE` = 96/72 px per pt), `stepZoom` (geometric ×1.2 with
   snap-back-to-fit-width), `effectiveSpread` (auto ⇒ spreads only in
   landscape), `layoutPages` (single centered column; spread = cover alone
   then pairs; one shared `scale` on the layout; mixed page sizes OK),
   `pageAtOffset` (binary search), `offsetForPage` (top-aligned with the
   layout padding — centering cut the page top off), `progressionForPage`/
   `pageForProgression` (center-based: 50 % ⇒ the middle page),
   `pageFromHref`/`hrefForPage` (`page-N`, the one locator format shared by
   chapters, index entries, progress and TOC).
2. **`src/pdf/pdfSession.ts`** — non-DOM document state (Node-testable):
   `PdfSession.open` surveys page sizes with progress, `getPageLabels()`,
   outline → `TocEntry[]` (depth + 5,000 cap + cycle guard + URI-action skip)
   with the ≤40 synthetic page-group fallback; zoom/spread/viewport state
   with invalidation; `visibleRange` ±2-page render window; locator
   construction (`location`/`progression`/`page`/`pageCount`/`pageLabel`/
   `chapterTitle`/`chapterHref`); `pageFromTarget` (`page-N` or percent).
3. **`src/pdf/pdfPageView.ts`** — canvas render queue (injectable
   `PageRenderer` so the queue is jsdom-testable without pdf.js): per-page
   render tokens (one in-flight render per page), DPR capped at 2, backing
   store capped at 32 Mpx, ≤8 canvases alive (evict farthest-from-window
   first), failed renders release their slot and retry on the next sync,
   `release(page)` hook → pdf.js `page.cleanup()` on eviction/destroy.
   `pdfjsPageRenderer(doc)` is the real renderer
   (`proxy.render({canvas, viewport, background: "#ffffff"})`).
4. **`src/reader/pdfEngine.ts`** — the ReaderEngine seam over session+view:
   `open()` lazily imports the pdf modules (factory stays sync), copies the
   bytes (pdf.js detaches the buffer it receives), maps
   PasswordException/InvalidPDF through `classifyPdfError`, builds
   `.folio-pdf-scroll > .folio-pdf-content`, wires scroll/pointer/click/
   contextmenu events + ResizeObserver, applies prefs, restores the resume
   target (`page-N`/percent) and emits the first locator. `go` (page-N or
   percent), `goForward`/`goBackward` (±1 page, capped at the ends),
   `scrollStep` (48 px), `applyPrefs` (theme ⇒ container vars, flow ⇒
   paginated scrollbar-less class, spread ⇒ re-layout anchored to the
   reading page; typography prefs ignored), `setZoom`/`zoomBy`/`getZoom`
   (session state, re-layout keeps the current page), `capabilities =
{format: "fixed", typography: false, zoom: true, flow: true,
spread: true, pageCount}`, `pageInfo()`, `toc()`, `search()` ⇒ `[]`
   (Phase 3), `applyDecorations`/`onSelection` no-ops (Phase 3),
   `onProgress` (load 0–50 %, page survey 50–100 %), `destroy` (DOM
   teardown, canvas queue, pdf.js document).
5. **`engineFactory.createEngine`** PDF branch now returns `new PdfEngine(...)`
   (flag-gated refusal retained for flag-off builds).
6. **UI wiring** — `useReaderEngine` exposes `capabilities` (set after
   `open()`, cleared on teardown/retry); `ReaderScreen` derives
   `pageInfo`/`dockStep` from the locator when `doc.format === "pdf"` and
   mirrors zoom state for the panel (`pdfZoom`, reset per doc, updated by
   the engine seam callbacks); `ReaderChrome` forwards `pageInfo`/`step`
   to the dock; `AppearancePanel` renders the fixed-layout variant
   (quick zoom stepper + zoom-mode + page-layout sections; typography
   preview/typeface/size/spacing/margins/width sections hidden) — zoom
   calls the engine (zoom is session state; `pdfZoom` stays a byte-compat
   dead field), spread patches `prefs.spread` normally.
7. **`src/styles/pdf.css`** — `.folio-pdf-scroll` (theme-coloured surround
   via `--pdf-page-bg` set by the engine), `.folio-pdf-page` (white page,
   shadow), paginated scrollbar hiding; imported from `main.tsx`.

**Tests added:** `tests/pdfLayout.test.ts` (14), `tests/pdfSession.test.ts`
(10, node env, real pdf.js over synthPdf fixtures), `tests/pdfPageView.test.ts`
(9, jsdom, fake renderer: windowing, dirty tracking, eviction + release,
invalidation, re-layout, destroy, DPR/backing-store caps, failure retry),
`tests/appearancePanel.test.tsx` +3 fixed-layout cases,
`tests/readerChrome.test.tsx` +1 pageInfo/step pass-through case.

**Pending Windows:** installer build, release CSP, worker/WASM load proof,
`open_files.rs` test run, manual EPUB + PDF smoke test.

## Phase 3 — text layer, selection, highlights, search, D2 ✅ done

Verified 2026-11-15 in the worktree. Gates: `tsc -b` clean; **Vitest 411 /
411 (54 files)** (396 pre-existing passing unmodified + 15 new); `vite build`
green (pre-existing chunk-size warning only); ESLint 0/0; Prettier clean.
Manual EPUB + PDF smoke test pending Windows.

1. **`src/pdf/permissions.ts`** (pure) — `noCopyFromPermissions`:
   pdf.js `getPermissions()` returns the /Encrypt permission set
   (`PermissionFlag.COPY` = 0x10) or `null` when unencrypted; no COPY ⇒
   `noCopy` (accessibility bit 0x200 is irrelevant to the copy decision —
   reading is never blocked). No DocMeta schema change; D2 is derived at
   engine-open into `capabilities.noCopy`.
2. **`src/pdf/quoteMatch.ts`** (pure, rewritten during implementation) —
   the haystack is the **verbatim concatenation** of text-layer span texts
   with each whitespace run collapsed to one space (a DOM selection's
   `toString()` is verbatim; mid-word item splits carry no space — an
   earlier separator-insertion approach was wrong and was rewritten).
   `matchQuote`/`quoteOccurrences` map a match back to span-local raw char
   offsets (case-insensitive, whitespace-tolerant, cap 20 occurrences);
   `extractContext` cuts the ≤32-char prefix/suffix from the page's joined
   text (same contract as EPUB).
3. **`src/pdf/pdfSearch.ts`** (pure) — `findPdfSearchHits`: one hit per
   occurrence over per-page text, case-insensitive, document order, capped
   200 hits, HTML-escaped `<mark>` snippets (48 chars of context),
   chapterTitle = outline section title or page label, fallback
   `"Page N"`; locator is the shared `page-N`.
4. **`src/pdf/pdfjsAdapter.ts`** gains `renderPdfTextLayer(source,
container, viewport)` (pdf.js `TextLayer` — the only pdf.js import site
   rule holds) and `textLayerViewport(page, scale)`. Contract verified
   against pdfjs-dist 6.5.438: pass the **CSS-scale** viewport — TextLayer
   multiplies `viewport.scale` by `devicePixelRatio` internally
   (`#scale = viewport.scale * #pixelRatio`); it sets `--min-font-size` on
   the container and needs `--total-scale-factor` / `--scale-round-x/y` on
   an ancestor.
5. **`src/pdf/pdfPageView.ts`** restructured to per-page `.folio-pdf-pagebox`
   wrappers: canvas + `.folio-pdf-textlayer` + `.folio-pdf-decorations` in
   one coordinate space; `--scale-factor` set inline per layout; the host
   box defines `--user-unit: 1`, `--scale-round-x/y: 1px`,
   `--total-scale-factor: calc(var(--scale-factor) * var(--user-unit))`.
   `PageTextFactory` (injectable, jsdom-testable) attaches the text layer
   lazily and re-attaches whenever the page's CSS size changes; a failed
   attach is tolerated (scanned pages have no text); `onTextReady(page)`
   fires the engine's decoration repaint. `pageBox(page)` accessor for
   decoration painting and hit-testing.
6. **`src/pdf/pdfSession.ts`** — cached `pageText(page)`
   (`joinTextItems` normalisation, 500-entry LRU cap) used by selection
   context and in-book search.
7. **`src/reader/pdfEngine.ts`**:
   - `capabilities.noCopy` from `getPermissions()` via the pure helper;
     a document-level `copy` event listener blocks native copy when set.
   - Real `onSelection`: document `selectionchange` debounced 120 ms →
     `TextSelectionInfo` (quote = collapsed `sel.toString()`, prefix/suffix
     via `extractContext` over `session.pageText`, `location = page-N`,
     viewport-coord rect for the toolbar) with dedupe; collapsed/outside
     selection ⇒ `null`.
   - Real `applyDecorations`: decodes EPUB-style anchor locators
     (`page-N?q=…&b=…&a=…` via `decodeLocation`; plain `page-N` accepted)
     → per-page entries; `repaintPageDecorations` builds DOM Ranges over
     `textNodeFor(span.firstChild)` for each `quoteOccurrences` match and
     paints `.folio-pdf-highlight` rects (page-relative, recorded for
     hit-testing); re-runs when `onTextReady` fires after a reflow.
   - Decoration hit-testing before click callbacks (`onDecorationClick`
     now emits; UI popover is hardening).
   - Real `search()` over `session.pageText` (≤20 hits/page, 200 total)
     returning schema-compatible `SearchHit` rows.
8. **`SelectionToolbar`** gains `copyDisabled` (button disabled +
   title "Copying is not allowed for this document"); `ReaderScreen`
   derives `noCopy = !!capabilities?.noCopy` and gates both `copyDisabled`
   and `shareEnabled={!!quoteSelection && !noCopy}` (Share-as-image D2).
9. **`src/styles/pdf.css`** — pagebox/textlayer/decoration rules (minimal
   copy of pdfjs-dist `pdf_viewer.css` `.textLayer` block, Apache-2.0,
   listed in THIRD-PARTY-NOTICES.md).

**Tests added:** `tests/pdfTextParts.test.ts` (13 — D2 permission cases;
multi-span / case / whitespace-run / mid-word / occurrences / raw-offset /
context quote matching; search order / escaping / label fallback / cap),
`tests/pdfPageView.test.ts` extended to 11 (pagebox structure, text-factory
lifecycle incl. reflow re-attach firing `onTextReady` [1,2,1,2], failed
attach, `pageBox()` accessor).

**Known limits moved to hardening (plan §12):** real RC4-encrypted fixture

- password path (encrypted refusal is pinned by message/code assertions);
  internal PDF link handling (`onLink` is a no-op); decoration-click popover
  UI (the engine callback emits; nothing renders yet). Range-rect painting
  itself is engine-level and untested in jsdom (no canvas 2d / reliable
  Range geometry).

**Pending Windows:** installer build, release CSP, worker/WASM load proof,
`open_files.rs` test run, manual EPUB + PDF smoke test (selection,
highlight paint, search, no-copy enforcement).

## Hardening phase — plan §12 ✅ done (2026-11-15, Linux-verifiable parts)

Gates: `tsc -b` clean; **Vitest 429 / 429 (57 files)** (411 pre-existing +
18 new, all pre-existing tests unmodified); `vite build` green; ESLint
0 errors / 0 warnings; Prettier clean.

1. **Encrypted-PDF fixture + password path.** `src/perf/synthPdf.ts` gains
   `buildEncryptedPdf(options)` — a real Standard security handler R2 /
   V1 / 40-bit RC4 document (RFC 7.6.3.3): MD5 + RC4 implemented in-file
   (verified against node crypto across 201 inputs, and against the
   blueimp-md5 reference implementation per-round while debugging), the
   32-byte padding string, O from the owner password, file key
   `MD5(pad(userPw) ‖ O ‖ P_le32 ‖ ID[0])[0..5]`, U = `RC4(fileKey, pad)`,
   per-object keys `MD5(fileKey ‖ obj_le32 ‖ gen_le16)[0..10]`; streams
   and strings encrypted, /Encrypt and xref/trailer in the clear. Fixed
   /ID keeps output byte-deterministic; `permissions: "all" | "no-copy"`
   (P = −1 / −17: clears only COPY 0x10, keeps accessibility 0x200 — the
   realistic producer output). Own binary writer; existing
   `buildSyntheticPdf` numbering untouched (no-link documents stay
   byte-identical).
   - Root-caused one subtle bug on the way: the 64-bit length field was
     written with `bitLength >>> (i*8)`, but JS shift counts wrap mod 32,
     so `>>> 32` silently repeated the low length word into the high
     bytes (empty input hashed correctly, every non-empty input broke).
     Now written via division.
   - `tests/pdfEncrypted.test.ts` (9 tests, node env): byte-determinism,
     `detectFormat` → "pdf", no-password open → `PasswordException`,
     wrong password → code 2 (`INCORRECT_PASSWORD`) classified
     `"encrypted"`, correct password opens + decrypts page text, D2
     no-copy end-to-end via real pdf.js `getPermissions()`, and the
     import refusal: `parsePdf` → `ImportError("encrypted")` with the
     v1.1 copy ("Remove the password and import it again."). Password UX
     stays per scope: encrypted files are refused at import; the
     `openPdf(bytes, {password})` retry path is exercised by tests only.
2. **Internal links.** `SynthPdfOptions.links` adds /Link annotations
   (GoTo dest arrays / URI actions, forward-referenced ids; object layout
   unchanged when unused). `pdfjsAdapter.pageLinkRects(doc, page, scale)`
   (the only pdf.js import site) resolves annotations → CSS-px rects
   relative to the page box via `viewport.convertToViewportPoint`, with
   GoTo targets resolved through `getPageIndex` (dangling dests skipped);
   rects scale with the render scale, never rescaled client-side.
   `pdfEngine` prefetches visible pages on layout/scroll keyed by scale
   (reserved-entry cache, silent failures), hit-tests clicks after
   decoration hits and before click callbacks: GoTo navigates internally
   via `jumpToPage`, URIs flow through `onLink` (useReaderEngine already
   gates them to http/https via `openExternal`). `onLink` is no longer a
   no-op. `tests/pdfLinks.test.ts` (4 tests, node env): resolution +
   geometry at scale 1/2, missing-page dest dropped, links + outline
   coexistence.
3. **Decoration-click popover.** `ReaderEngine.onDecorationClick` is now
   `(cb: (id, at?: {x, y}) => void)` (additive optional position in
   engine-container coords; Readium doesn't implement the hook).
   `pdfEngine.emitDecorationHit` passes the click position. New
   `components/DecorationPopover.tsx` (fixed-position menu mirroring the
   reduced context menu: outside-mousedown + Escape dismissal) with
   Add/Edit note (reuses the existing note-editor flow via
   `editingAnnotation`) and Remove highlight (same library-manager delete
   path as the TOC panel, then `refreshAnnotations` repaint).
   `ReaderScreen` wires it through a `decorationClickRef` (ref pattern
   like `contextMenuRef`; `useReaderEngine` subscribes with
   `engine.onDecorationClick?.()`), the popover participates in the
   `holds` memo ("menu" hold), `pdf.css` adds
   `.folio-pdf-decor-popover`. `tests/decorationPopover.test.tsx` (5
   tests): labels, close+action on click, Escape and outside-mousedown
   dismissal.
4. **Windows smoke checklist (recorded, not run here)** — see the session
   record's pending list: installer build (`pnpm tauri:build`), release
   CSP review, worker/WASM asset load proof under WebView2,
   `open_files.rs` cargo tests, and manual smoke: import (incl.
   encrypted refusal + >50 MB cap), open/resume, zoom/fit modes,
   selection → highlight → popover edit/remove, in-book search, link
   click (GoTo page + external URL), no-copy PDF (copy disabled, text
   selection allowed), keyboard turning, bookmark, backup/restore of a
   PDF library. Also verify **anchored-surface placement**: the reduced
   context menu, the decoration popover and the selection toolbar land at
   the pointer/cursor. Both engines emit container-relative coordinates
   that fixed-position UI consumes directly; if any surface appears
   offset by the canvas's viewport origin (`.folio-reader__canvas` starts
   56 px down), correct it at the shared consumer boundary in
   ReaderScreen — a pre-existing question, deliberately not rewritten in
   this feature work.
