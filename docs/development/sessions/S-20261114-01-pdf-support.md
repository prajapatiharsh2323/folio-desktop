# S-20261114-01 — PDF Support Phases 0–3

**Session:** PDF support implementation, Phases 0–3 complete
**Updated:** 2026-11-15
**Where:** isolated worktree
`~/.local/share/opencode/worktree/8cca39/pdf-support` (branch of `main` @
`380e6b3`), because `S-20261113-01` has uncommitted Step 2.1 work in the main
checkout and Step 2.2 (R4 back navigation) as its next action.
**Full record:** [`I-20261114-01`](../plans/implementations/I-20261114-01-pdf-support.md)

## Status

- Phase 0 (groundwork, no behaviour change): **done, gates green**.
- Phase 1 (import & storage): **done, gates green** — pdfjs-dist 6.5.438
  (exact pin, CVE-vetted — see `I-20261114-01` for the advisory analysis),
  `pdfjsAdapter.ts` (sole import site), Vite static assets + CSP,
  `fileDetector` PDF branch, `parsePdf`, `importService` PDF pipeline,
  `pdfIndexJob` + `reconcileIndexes` + boot hook + `reindexDocs` branch,
  Library PDF badge, pickers/file association/copy updates, backup D1 PDF
  warning + PDF round-trip test.
- Phase 2 (reader MVP): **done, gates green** — `tsc -b` clean;
  **Vitest 396 / 396 (53 files)** (all 359 Phase-1 tests passing
  unmodified + 37 new); `vite build` green; ESLint 0/0; Prettier clean.
  Shipped: `pdfLayout.ts` (pure math), `pdfSession.ts` (non-DOM document
  state, Node-testable), `pdfPageView.ts` (canvas render queue: token
  cancellation, DPR ≤ 2, 32 Mpx backing-store cap, ≤ 8 canvases, release
  hook → `page.cleanup()`), `src/reader/pdfEngine.ts` (full ReaderEngine
  seam: open/resume/locator/go/turns/scrollStep/zoom/flow/spread/theme,
  `capabilities`, `pageInfo`, `toc`, progress events, destroy),
  `engineFactory` PDF branch wired, `useReaderEngine.capabilities`,
  `ReaderScreen` pageInfo/dockStep/zoom mirror, `ReaderChrome` → dock
  pass-through, `AppearancePanel` fixed-layout variant (zoom stepper +
  zoom-mode + page-layout sections, typography hidden), `pdf.css`.
  Locator format everywhere is plain `page-N`; progression↔page mapping is
  center-based; page jumps top-align with the layout padding.
- Phase 3 (text layer, selection, highlights, search, D2): **done, gates
  green** — `tsc -b` clean; **Vitest 411 / 411 (54 files)** (all 396
  Phase-2 tests passing unmodified + 15 new); `vite build` green; ESLint
  0/0; Prettier clean. Shipped: `permissions.ts` (pure D2 decision from
  pdf.js `getPermissions()`), `quoteMatch.ts` (verbatim-concat span
  matching → span-local raw offsets), `pdfSearch.ts` (pure search-hit
  builder), `pdfjsAdapter` text-layer seam (`renderPdfTextLayer` — pdf.js
  TextLayer takes the CSS-scale viewport), `pdfPageView` pagebox
  structure (canvas + text layer + decorations, lazy text attach,
  `pageBox()` accessor), `pdfSession.pageText` cache, `pdfEngine` real
  `onSelection` / `applyDecorations` / `search()` / decoration
  hit-testing / no-copy event block, `SelectionToolbar.copyDisabled`,
  `ReaderScreen` D2 gates (Copy disabled + Share-as-image hidden),
  `pdf.css` text/decoration rules. Details in `I-20261114-01` Phase 3.
- Decisions D1–D5 adopted (user-confirmed). D5 caveat: raw-bytes IPC (report
  item E1) is **not** landed, so the PDF size cap stays at 50 MB.
- Environment notes: pnpm 11.28.12 installed via `npm i -g pnpm@11`; the
  worktree has its own `node_modules`. pdf.js tests must run under
  `// @vitest-environment node` (jsdom has no worker support); fixtures are
  generated in-repo via `src/perf/synthPdf.ts`.
- Uncommitted: everything. Commit only with explicit authorization; on merge,
  reconcile with `S-20261113-01`'s uncommitted Step 2.1 (its `minisearch`
  dependency will arrive via that merge).
- Pending Windows: installer, release CSP, worker/WASM load proof,
  `open_files.rs` tests, manual EPUB + PDF smoke tests.

## Status (2026-11-15): hardening items 1–3 done, gates green

**Hardening phase (plan §12)** — items 1–3 are complete; `tsc -b` clean,
**Vitest 429 / 429 (57 files)** (411 pre-existing + 18 new, unmodified),
`vite build` green, ESLint 0/0, Prettier clean. Details in
`I-20261114-01` ("Hardening phase" section): encrypted fixture + password
path (synthPdf `buildEncryptedPdf`, real R2/RC4; import refuses encrypted
files per v1.1 scope), internal link handling (`pageLinkRects` + engine
prefetch/hit-test, GoTo → `jumpToPage`, URI → `onLink`), and the
decoration-click popover (`DecorationPopover` + ReaderScreen wiring, note
edit/remove reusing existing flows).

## Exact next action

1. Windows-only verification checklist (record as pending until run on a
   supported host — this Linux box has no webkit2gtk): installer build
   (`pnpm tauri:build`), release CSP review, worker/WASM load proof under
   WebView2, `open_files.rs` cargo test run, manual smoke: import (incl.
   encrypted refusal + >50 MB cap), open/resume, zoom/fit modes,
   selection → highlight → popover edit/remove, in-book search, link
   click (GoTo page + external URL), no-copy PDF, keyboard turning,
   bookmark, backup/restore of a PDF library. Also verify anchored-surface
   placement (context menu, decoration popover, selection toolbar land at
   the pointer): engines emit container-relative coords for fixed-position
   UI; if misaligned in the webview, correct at the ReaderScreen consumer
   boundary (pre-existing question, shared with the EPUB path).
2. Merge-time work (still pending): commit (explicit authorization only)
   and reconcile with `S-20261113-01`'s uncommitted Step 2.1 in the main
   checkout; its `minisearch` dependency arrives via that merge.
