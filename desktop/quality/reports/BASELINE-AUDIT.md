# Baseline audit — Folio Desktop (read-only)

Date: 2026-11-28 · Commit `ed7a3a1` (`main`, no tracked changes) · Linux host.
No application source, dependency, lockfile, fixture, setting or user document
was changed. Full command results: `BASELINE.md`. Confirmed defects:
`ISSUE-REGISTER.md` + `issues/`. Hypotheses: `SUSPECTED-RISKS.md`.

## 1. Architecture and feature-flow map

### Boot and shell
`main.tsx` (pre-paint theme, UI zoom, contrast, locale, synced prefs, error
handlers) → `App.tsx` (`useBoot`, boot splash, onboarding stages) →
`ErrorBoundary(root)` → `Shell.tsx` → sidebar + one active screen. Reader is a
route (`route === "reader"`), sidebar hidden, wrapped in a separate
`ErrorBoundary(variant="reader")`. Global `CommandPalette`, `ToastHost`,
Ctrl+K/F11/Ctrl+, / Ctrl+1–5 live in the shell.

### Route → screen → state → persistence/native → rendering

| Route / feature | Screen | State/store | Repository / native | Rendering |
|---|---|---|---|---|
| Library | `screens/LibraryScreen.tsx` | `routeStore`, `libraryUi` (`useLibraryUi`), `libraryView` | `LibraryManager` → `repos` (`manifest`, `docMeta`, `progress`, annotations, collections, settings) → `FileStore` → Tauri `fs_*` commands via path guard; `libraryIndex` + worker + `searchCache` | `FolioBookRow`, `FolioChip`, grids/lists, dialogs |
| Collections | `CollectionsScreen.tsx` | `routeStore.readerOrigin`, local dialog state | `LibraryManager.setDocCollections` / `mutateCollectionDocs` / `create|rename|deleteCollection` (dual-write + manifest refresh) | Panels/dialogs, book rows |
| Notes | `NotesScreen.tsx` | local filters | `LibraryManager.annotations.listForDoc` / `remove` / `update`, `readingLog` | Rows, quote cards, export |
| Insights | `InsightsScreen.tsx` | local range state | `readingLog`, `progress` repos | Charts/stats, empty state |
| Settings | `SettingsScreen.tsx` | `theme`, `uiZoom`, `highContrast`, `i18n`, `syncedPrefs` | `storage` localStorage + `window.json` via `writeJsonAtomic`, `backupService`, `updater`, `fullscreen` | Settings rows/chips/dialogs |
| Reader | `screens/ReaderScreen.tsx` | `readerStore` (doc/status/prefs/progress), `routeStore` (request/origin), `useReaderEngine`, `useReaderChrome`, `useReaderKeyboard`, `useAnnotations`, `useInBookSearch` | `readerStore.load` → `LibraryManager.meta.read`, `prefs.resolved`, `progress.get`, `fs.readBytes`; `engineFactory` → `ReadiumEngine` or `PdfEngine`; `ProgressWriter` → `readerStore.persistProgress` → `progress`/`readingLog` repos | `ReaderCanvas`, `ReaderChrome`/`ReaderDock`, panels, popovers, dialogs, splash |

### Reader lifecycle (EPUB and PDF traced independently)

- Open: `readerStore.load` loads meta/bytes/prefs/progress (stale-load token,
  blob URL revocation) → `useReaderEngine` effect builds one engine, one
  `NavigationCoordinator`, one `ProgressWriter`, one `ReadingPaceStats` per
  doc id. Resume cascade: `resumePlan` → `planTarget` → engine `open(initial)`.
- EPUB: `ReadiumEngine.open()` unzips via `epubPublication`, builds positions,
  creates `EpubNavigator` with the initial locator, registers frame/listener
  hooks, applies prefs, registers decoration observer. `destroy()` clears all
  callback sets, frame hooks and observer, destroys navigator and closes zip.
- PDF: `PdfEngine.open()` lazily imports pdf.js, parses the document, builds a
  `PdfSession` layout/TOC, registers listeners; `applyPdfPrefs` handles layout;
  `destroy()` cancels tokens and releases the document.
- Progress: locator callback converts progression→percent, applies gate
  (`ProgressWriter`: 0.4% / 500 ms / 3 s, 60 s restore suppression), writes
  via `persistProgress`, credits `readingLog`. Close path `handleBack` awaits
  `flushAndClose` before clearing the doc; `beforeunload`/close-request and
  other route exits use a fire-and-forget flush (DATA-006).
- Navigation: all moves go through the coordinator (seek gating,
  supersession, position history). EPUB internal links/noterefs are intercepted
  in-frame; PDF links use pdf.js link rects.
- Annotations: `useAnnotations` loads/paints decorations via `engine.applyDecorations`,
  creates/toggles highlights and notes through `LibraryManager.annotations`,
  bookmarks from `engine.currentLocator()`.
- Search: `useInBookSearch` → `engine.search()`; EPUB builds a MiniSearch index
  in memory with occurrence anchors; PDF hits are page/locator based.
- Teardown: engine effect cleanup unsubscribes all listeners, flushes progress,
  destroys the engine and clears refs; keep-awake polling and fullscreen
  cleanup are partial (READ-004).

### Persistence map
`manifest.json` is the commit point (last write). `meta.json` per doc under
`library/docs/<slug>/`; user data under `library/user/`
(annotations, progress, collections, settings, doc-settings, reading-log,
pdf-prefs, epub-prefs); device-local index under `library/index/text/`;
`user/window.json` is desktop-only, outside backups. Paths are TypeScript-owned
(`libraryPaths.ts`, virtual `/folio-library`), Rust maps the prefix through
`foliocore` path guard. JSON read→patch→rewrite preserves unknown keys;
Schema-1 field names/enums are frozen.

### Overlay, focus and visual system
`shell/modalStack.ts` (last-opened-wins token, ancestor-aware inert),
`shell/overlays.ts`, `focusTrap.ts`, `FolioDialog` (focus save/restore, Escape
ladder), `FolioPanel` (modal vs docked), `FolioMenu`, `ToastHost`. Tokens and
shared primitives in `styles/tokens.css`, `base.css`, `components.css`,
`reader.css`, `pdf.css`. Issue UI-018 shows the token-reference layer is not
fully consistent.

## 2. Exact baseline commands and results

See `BASELINE.md` for the full table. Summary (all from `desktop/`):
- `npx --yes pnpm@11.0.0 install --frozen-lockfile` — installed from lockfile (9.5 s).
- `./node_modules/.bin/tsc -b` — exit 0.
- `./node_modules/.bin/vitest run` — **99 files / 776 tests passed** (210.62 s), exit 0.
- `./node_modules/.bin/eslint . --max-warnings 0` — exit 0 when run alone.
- `./node_modules/.bin/vite build` — success (1 m 17 s, chunk-size warning).
- `./node_modules/.bin/vite --host 127.0.0.1` — served app HTML on port 1420; stopped.
- `cd src-tauri && cargo test -p foliocore --all-targets` — 14/14 passed.

Not run (and not claimed): Tauri build/dev window, full-crate cargo test/fmt,
NSIS installer, Windows E2E, perf profiling — Windows/WebView-only on this
Linux host. The first parallel ESLint run hit a transient race with Vite's
temporary config file; the isolated rerun was clean.

## 3. Confirmed defects, ranked P0 → P3

- **P0:** none confirmed.
- **P1:** `DATA-001` — editing details leaves a stale manifest hash; the
  library's own backup then fails to restore (runtime reproduced).
- **P2:** `SEARCH-001` (imported PDFs unsearchable until restart), `IMPORT-001`
  (inline images missing from generated EPUB), `READ-006` (no-copy PDF still
  offers citation copy/share), `READ-018` (PDF last page never reaches 100%),
  `UI-002` (non-modal panels trap Tab), `UI-006` (inverted keep-awake copy),
  `UI-011` / `UI-012` (unlabeled inputs), `UI-018` (undefined CSS tokens),
  `SEARCH-002` (cache signature ignores index content; user-facing repro pending),
  `IMPORT-002` (failure reported after commit; probable).
- **P3:** `READ-009` (no-op page-number toggle), `UI-007` (destructive action
  styled primary), plus the confirmed cosmetic/consistency items listed in the
  register (`UI-008`, `UI-009`, `UI-015`, `UI-016`, `IMPORT-006`, `NAT-003`).

Full reproduction steps, evidence, root cause and proposed fixes are in
`ISSUE-REGISTER.md` and `reports/issues/*.md`.

## 4. Suspected risks (separate, not defects yet)

Highest impact: `READ-001` (uncancellable open), `READ-002` (stale annotation
paint), `IMPORT-003` (replace data-loss risk), then `DATA-002..011`,
`READ-004/005/007/011/012/015/017`, `IMPORT-004/005`, `NAT-002/004`,
`SHELL-001/004/005`, `UI-003/004/014`. Each has file evidence, an expected-vs-
actual hypothesis and a confirming test in `SUSPECTED-RISKS.md`. None may be
called fixed or confirmed without running that test.

## 5. Missing tests and blind spots

- No test asserts the manifest `meta.json` hash after `updateMeta` (DATA-001).
- No import→index handoff test (SEARCH-001) and no content-aware cache test
  (SEARCH-002).
- No EPUB data-URI image test that inspects the built EPUB ZIP (IMPORT-001).
- No no-copy UI test; no PDF completion/end-card test; no page-number toggle test.
- No focus test for Tab escaping a non-modal `FolioPanel`; no accessible-name
  assertions for create-collection or note dialogs.
- No CSS reference-resolution test; `tests/tokens.test.ts` only pins defined
  token values.
- No delayed-open / delayed-refresh cancellation tests; no concurrent write
  serialization tests; no corrupt-JSON recovery test.
- Runtime blind spots: native Tauri commands, Windows WebView rendering, NSIS
  build/install, E2E WebDriver smoke, real screen-reader session, high-contrast
  and UI-zoom screenshots, perf profiling, and any real user document.

## 6. Next three smallest safe tasks

1. **UI-006** — swap the inverted status strings (`SettingsScreen.tsx:224-226`)
   and add a settings copy test.
2. **UI-002** — gate `trapTabKey` on `modal` in `FolioPanel.tsx:91`; add a
   focus test covering both panel modes.
3. **UI-011 + UI-012** — add `aria-label` to the create-collection input and
   the note textareas; assert them with `getByRole(..., { name })`.

Then fix DATA-001 with its permanent regression test (highest confirmed harm).
See `plans/REMEDIATION-ROADMAP.md` for the full prioritized sequence.

## 7. Remediation batch 1 — executed and verified (same day)

All three smallest safe tasks above were completed after the audit go-ahead.
For each, a failing regression test was written on current HEAD first (4 new
tests failed), then the minimal fix applied:

- **UI-006** — inverted strings swapped in `SettingsScreen.tsx`.
- **UI-002** — `FolioPanel` attaches `trapTabKey` only when `modal === true`;
  docked panels let Tab leave the panel while modal panels still trap it.
- **UI-011 / UI-012** — `aria-label` added to the create-collection input,
  the Notes edit textarea and the reader note editor.

Verification (actually run): focused RED 4 failures → focused GREEN 4 files /
29 tests; full `vitest run` **100 files / 781 tests passed**; `tsc -b` exit 0;
`eslint . --max-warnings 0` exit 0; `vite build` success. No schema, format,
storage key or backup contract changed; no user data touched. Remaining blind
spot: no native-window keyboard/screen-reader check on this Linux host.
Details: `reports/TEST-MATRIX.md`, `reports/issues/UI-00{2,6}.md`,
`reports/issues/UI-01{1,2}.md`, `TASKS.md`.

### Remediation batch 2 — DATA-001, executed and verified (same day)

The highest-severity confirmed defect was fixed after batch 1. A permanent
regression test was added to `tests/libraryManager.test.ts` on current HEAD:
`addDoc` → `updateMeta` → assert the manifest `meta.json` entry's size/sha256
match the file on disk → `createBackup` → `restoreBackup` into a fresh root.
It failed RED (manifest 581 bytes vs 601 actual). `LibraryManager.updateMeta()`
now recomputes that file entry immediately after `meta.write()` and before the
manifest commit, matching the other `meta.json`-mutating mutators. A grep of all
six `meta.write()` callers confirmed no other stale-hash path.

Verification actually run: focused RED 1 failure → GREEN 9/9 in the file;
full `vitest run` **100 files / 782 tests passed**; `tsc -b` 0; ESLint 0;
`vite build` success. Schema-1 fields, storage keys and backup format unchanged;
no real user library touched. Remaining blind spot: no native-window manual
backup/restore of a real library on this Linux host. Details:
`reports/issues/DATA-001.md`, `reports/TEST-MATRIX.md`, `TASKS.md`.

### Remediation batch 3 — SEARCH-001 and IMPORT-001, executed and verified

Two import/search defects were fixed after RED-phase tests:
- **SEARCH-001** — `tests/importPdf.test.ts` showed `enqueueIndex` was never
  called on PDF import or Replace. `importService` now enqueues the background
  index job after a successful commit in both paths, so library search sees the
  document in the current session instead of only after a restart.
- **IMPORT-001** — `tests/import.test.ts` unzipped the generated EPUB and found
  no `OEBPS/images/*` entries despite OPF references. `buildEpub()` now accepts
  `imageBytes` and writes those entries; `importService` passes the bytes it
  already extracted for `clean/images/`.

Verification actually run: RED 3 tests → focused GREEN 38 import tests;
full `vitest run` **100 files / 785 tests passed**; `tsc -b` 0; ESLint 0;
`vite build` success. Byte-pinned import snapshots still pass (their fixtures
have no inline images). Schema-1 and backup formats unchanged; no user data
touched. Residual risks: SEARCH-002 can still hide a finished index from an
already-open search panel; no native-window PDF import/search check on Linux.
Details: `reports/issues/SEARCH-001.md`, `reports/issues/IMPORT-001.md`,
`reports/TEST-MATRIX.md`, `TASKS.md`.

### Remediation batch 4 — SEARCH-002, READ-006, READ-018, executed and verified

- **SEARCH-002** — RED tests showed the search signature ignored index rewrites.
  `src/lib/searchCache.ts` now owns a zustand generation counter included in
  `searchSignature()`; `importService.writeIndex`, `pdfIndexJob` and
  `backup/reindex` all bump it, and `LibraryScreen` rebuilds its corpus when it
  changes (including discarding a build invalidated mid-flight).
- **READ-006** — `SelectionToolbar` now disables Copy with citation and Share
  as image alongside Copy for `noCopy` documents, with explanatory titles.
- **READ-018** — `PdfSession.progression()` returns 1 on the final page; the
  center-based scrub mapping and its 17 pinned tests are untouched.

Verification actually run: RED 4 tests → focused GREEN 69 tests; full
`vitest run` **100 files / 789 tests passed**; `tsc -b` 0; ESLint 0;
`vite build` success. No schema, locator, progress or backup format changed;
no user data touched. Remaining blind spots: no native-window manual search /
no-copy / completion checks on this Linux host. Details:
`reports/issues/SEARCH-002.md`, `reports/issues/READ-006.md`,
`reports/issues/READ-018.md`, `reports/TEST-MATRIX.md`, `TASKS.md`.

### Remediation batch 5 — IMPORT-002 and IMPORT-003, executed and verified

Both were promoted from suspected to confirmed with failing-`FileStore` tests:
- **IMPORT-003** — RED test showed the original file was gone after a failed
  Replace. `LibraryManager.moveFolder()` plus a staged swap in `replaceDoc()`
  now restore the original on commit failure and clean staging only after
  success.
- **IMPORT-002** — RED test showed a committed doc after a `refused` result.
  Derived index writes now precede the commit point in both import paths.

Verification actually run: RED 2 tests → focused GREEN 43 import/search tests;
full `vitest run` **101 files / 791 tests passed**; `tsc -b` 0; ESLint 0;
`vite build` success. No schema, backup or storage-format change; no user data
touched. Residual risks: no Windows disk-full simulation, and a crash between
staging rename and cleanup can leave an unreferenced orphan folder (ignored by
recovery). Details: `reports/issues/IMPORT-002.md`,
`reports/issues/IMPORT-003.md`, `reports/TEST-MATRIX.md`, `TASKS.md`.

### Remediation batch 6 — UI-018, executed and verified

The new `tests/cssTokenRefs.test.ts` failed RED on three dangling names
(`--folio-radius`, `--folio-bg-elevated`, `--folio-bg-active`). They were mapped
by role to `--folio-radius-control`/`--folio-radius-cover`,
`--folio-surface-raised` and `--folio-accent-container`. `--folio-focus` was
given a real literal definition in both themes (and deliberately added to the
byte-pinned `tests/fixtures/tokens.json`), so the focus outline is valid in
normal themes while the forced-colors override still wins. Reader-only tokens
keep their fallbacks, now guarded by a second assertion.

Verification actually run: RED 2 tests → GREEN 5 focused tests; full
`vitest run` **102 files / 793 tests passed**; `tsc -b` 0; ESLint 0;
`vite build` success. No user data touched. Residual risk: no real-window
screenshot comparison for the palette/skeleton visuals on this Linux host.
Details: `reports/issues/UI-018.md`, `reports/TEST-MATRIX.md`, `TASKS.md`.

### Remediation batch 7 — UI-003, UI-007, UI-013, UI-014, executed and verified

Final consistency batch of confirmed issues:
- **UI-007** — the destructive reset button uses the danger variant, asserted
  in the existing settings reset flow test.
- **UI-013** — single-select Settings groups and Library search-scope/kind
  filters now use the existing `FolioRadioGroup` primitive (radiogroup/radio,
  aria-checked, roving tab stop, arrow keys) instead of independent
  `aria-pressed` chips.
- **UI-014** — `role="option"` buttons in the command palette and library search
  are no longer tab stops, preserving the combobox/aria-activedescendant model.
- **UI-003** — `FolioMenu` gained Arrow/Home/End navigation and a roving tab
  stop; modal inerting remains tracked separately as SHELL-004.

Verification actually run: RED assertions for all four → focused GREEN
(settings 12, command palette 7, menu 3, radio group 5, axe sweep 10); full
`vitest run` **103 files / 798 tests passed**; `tsc -b` 0; ESLint 0;
`vite build` success. Typecheck initially caught the numeric zoom values needing
string options in `FolioRadioGroup`; resolved by mapping to strings and back.
No user data touched. Details: `reports/issues/UI-00{3,7}.md`,
`reports/issues/UI-01{3,4}.md`, `reports/TEST-MATRIX.md`, `TASKS.md`.
