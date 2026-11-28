# Regression test matrix — status after remediation batches 1–7 (2026-11-28)

Legend: `Auto` = automated test covers the row; `Partial` = some paths covered;
`—` = no runtime coverage on this host. All "Auto" rows were executed:
`vitest run` → 103 files / 798 tests passed (22 new tests across seven batches).

| Journey | EPUB | PDF | Restart/persistence | Keyboard | Pointer/touch | Light/dark | Status/evidence |
|---|---:|---:|---:|---:|---:|---:|---|
| Launch and open book | Partial | Partial | — | — | — | — | `tests/shell.test.tsx`, `reader.test.ts`, `parsePdf.test.ts`; native launch not run on Linux |
| Resume exact location | Auto | Auto | Partial | — | — | — | `locatorCodec`, `locatorNavigation`, `pdfSession`, `progressWriter`, `reopenLast`; DATA-006/READ-005 still open |
| TOC/chapter navigation | Auto | Auto | — | Partial | — | — | `navigation.test.ts`, `pdfSession.test.ts`, `readerKeyboardBack.test.tsx` |
| Previous/next/page scrub | Auto | Auto | — | Auto | — | — | `readerChrome.test.tsx`, `pdfLayout.test.ts`; **READ-018 fixed** (last page = 100%, scrub mapping unchanged) |
| Search and navigate hit | Partial | Partial | — | Partial | — | — | `libraryIndex`, `pdfIndexJob`, `inbookSearchPanel`; **SEARCH-001/002 fixed** (enqueue + content-aware cache covered) |
| Select text and create highlight | Auto | Auto | Partial | — | — | — | `annotationActions`, `epubDecorationRange`, `annotationOverlap`; **READ-006 fixed** (no-copy extraction actions disabled) |
| Edit note / delete annotation | Auto | Auto | Partial | — | — | — | `notesScreen.test.tsx` (new accessible-name test), `noteEditor` reader flow via shared change; UI-012 fixed |
| Footnote/internal link | Auto | Partial | — | — | — | — | `footnotes.test.ts`, `pdfLinks.test.ts`; READ-017 hypothesis open |
| Change appearance and reset | Auto | Auto | Partial | — | — | — | `appearancePanel`, `pdfAppearancePanel`, `epubPrefs`, `pdfPrefs`; READ-009 no-op toggle open |
| Close during loading | — | — | — | — | — | — | No test; READ-001 open |
| Rapidly switch documents | — | — | — | — | — | — | No test; READ-002/003 hypotheses open |
| Backup and restore | Auto | Auto | Auto | — | — | — | `backup.test.ts`, `backupPdf.test.ts`; **DATA-001 fixed**: `libraryManager.test.ts` covers updateMeta → manifest hash → restore; IMPORT-003 fixes Replace data-loss path |
| Import and duplicate handling | Auto | Auto | Partial | — | — | — | `import*.test.ts`, new `importReplace.test.ts`, `folderImport.test.ts`; **IMPORT-001/002/003 fixed** (images, refusal-after-commit, staged Replace rollback covered) |
| **Modal focus/Escape/focus return** | Partial | Partial | — | **Auto** | — | — | `modalStack`, `focusStability`, `activePanel.test.tsx`, new `folioMenu.test.tsx`; **UI-002 fixed** and **UI-003 keyboard semantics fixed** (arrow/Home/End + roving tab) |
| Resize/fullscreen/UI zoom | — | — | — | Partial | — | — | `uiZoom.test.ts`, `fullscreen` code; READ-004/UX-005 hypotheses open |
| **Single-select / combobox semantics** | Auto | Auto | — | Auto | — | — | `settings.test.tsx` (UI-013 radio groups), `commandPalette.test.tsx` (UI-014 options not tab stops), `folioRadioGroup.test.tsx` |
| **Token reference integrity** | Auto | Auto | — | — | — | — | new **`cssTokenRefs.test.ts`** (UI-018 fixed: no dangling refs; reader fallbacks guarded) |
| **Settings status copy** | — | — | — | — | — | — | **`settings.test.tsx`** (UI-006 fixed: On/Off messages asserted) |
| **Collections create-dialog label** | — | — | — | — | — | — | **`collectionDialogA11y.test.tsx`** (UI-011 fixed) |

## Batch 1 verification commands (all actually run)

| Command | Result |
|---|---|
| `./node_modules/.bin/vitest run tests/settings.test.tsx tests/activePanel.test.tsx tests/notesScreen.test.tsx tests/collectionDialogA11y.test.tsx` (RED, before fixes) | 4 new tests failed as expected; 25 pre-existing tests passed |
| Same command (GREEN, after fixes) | 4 files / 29 tests passed |
| `./node_modules/.bin/tsc -b` | exit 0 |
| `./node_modules/.bin/eslint . --max-warnings 0` | exit 0 |
| `./node_modules/.bin/vitest run` | 100 files / 781 tests passed |
| `./node_modules/.bin/vite build` | success (31.97 s; pre-existing chunk-size warning) |

Batch 2 (DATA-001) verification:

| Command | Result |
|---|---|
| `./node_modules/.bin/vitest run tests/libraryManager.test.ts -t "DATA-001"` (RED) | 1 test failed — manifest size 581 vs actual 601 |
| `./node_modules/.bin/vitest run tests/libraryManager.test.ts` (GREEN) | 9 tests passed |
| `./node_modules/.bin/tsc -b` | exit 0 |
| `./node_modules/.bin/eslint . --max-warnings 0` | exit 0 |
| `./node_modules/.bin/vitest run` | 100 files / 782 tests passed |
| `./node_modules/.bin/vite build` | success (36.26 s; same pre-existing chunk-size warning) |

Batch 3 (SEARCH-001, IMPORT-001) verification:

| Command | Result |
|---|---|
| `./node_modules/.bin/vitest run tests/importPdf.test.ts -t "SEARCH-001"` (RED) | 2 tests failed — `enqueueIndex` called 0 times |
| `./node_modules/.bin/vitest run tests/importPdf.test.ts` (GREEN) | 7 tests passed |
| `./node_modules/.bin/vitest run tests/import.test.ts -t "IMPORT-001"` (RED) | 1 test failed — 0 `OEBPS/images/*` entries |
| focused import suites (GREEN) | `import.test.ts` 26 + `importBaseline.test.ts` 5 + `importPdf.test.ts` 7 = 38 passed |
| `./node_modules/.bin/tsc -b` | exit 0 |
| `./node_modules/.bin/eslint . --max-warnings 0` | exit 0 |
| `./node_modules/.bin/vitest run` | 100 files / 785 tests passed |
| `./node_modules/.bin/vite build` | success (37.92 s; same pre-existing warning) |

Batch 4 (SEARCH-002, READ-006, READ-018) verification:

| Command | Result |
|---|---|
| `./node_modules/.bin/vitest run tests/searchCache.test.ts tests/import.test.ts -t "SEARCH-002"` (RED) | 2 tests failed — generation API missing |
| `./node_modules/.bin/vitest run tests/citationShare.test.tsx -t "READ-006"` (RED) | 1 test failed — citation/share still enabled |
| `./node_modules/.bin/vitest run tests/pdfSession.test.ts -t "last page so reading can complete"` (RED) | 1 test failed — 0.95 instead of 1 |
| focused suites (GREEN) | `searchCache` 3 + `import` 27 + `pdfIndexJob` 4 + `backupPdf` 1 = 35; `citationShare` 4 + `pdfSession` 13 + `pdfLayout` 17 = 34 |
| `./node_modules/.bin/tsc -b` | exit 0 |
| `./node_modules/.bin/eslint . --max-warnings 0` | exit 0 |
| `./node_modules/.bin/vitest run` | 100 files / 789 tests passed |
| `./node_modules/.bin/vite build` | success (28.63 s; same warning) |

Batch 5 (IMPORT-002, IMPORT-003) verification:

| Command | Result |
|---|---|
| `./node_modules/.bin/vitest run tests/importReplace.test.ts -t "IMPORT-003"` (RED) | 1 test failed — `ENOENT` on the original file |
| `./node_modules/.bin/vitest run tests/importReplace.test.ts -t "IMPORT-002"` (RED) | 1 test failed — 1 doc committed after a refused result |
| focused import/search/backup suites (GREEN) | 56 tests passed, then 43 tests passed |
| `./node_modules/.bin/tsc -b` | exit 0 |
| `./node_modules/.bin/eslint . --max-warnings 0` | exit 0 |
| `./node_modules/.bin/vitest run` | 101 files / 791 tests passed |
| `./node_modules/.bin/vite build` | success (57.05 s; same warning) |

Batch 6 (UI-018) verification:

| Command | Result |
|---|---|
| `./node_modules/.bin/vitest run tests/cssTokenRefs.test.ts` (RED) | 2 tests failed — 3 dangling tokens found |
| same command + `tests/tokens.test.ts` (GREEN) | 5 tests passed; deliberate `--folio-focus` addition pinned in both themes |
| `./node_modules/.bin/tsc -b` | exit 0 |
| `./node_modules/.bin/eslint . --max-warnings 0` | exit 0 |
| `./node_modules/.bin/vitest run` | 102 files / 793 tests passed |
| `./node_modules/.bin/vite build` | success (29.06 s; same warning) |

Batch 7 (UI-003, UI-007, UI-013, UI-014) verification:

| Command | Result |
|---|---|
| RED: `tests/settings.test.tsx -t "single-select semantics"`, `tests/commandPalette.test.tsx -t "extra tab stops"`, `tests/folioMenu.test.tsx`, settings danger-class assertion | all failed before fixes |
| focused suites (GREEN) | settings 12, commandPalette 7, folioMenu 3, folioRadioGroup 5, axeSweep 10 |
| `./node_modules/.bin/tsc -b` | exit 0 (after adapting zoom options to string values) |
| `./node_modules/.bin/eslint . --max-warnings 0` | exit 0 (menu root focusable; no useless assignment) |
| `./node_modules/.bin/vitest run` | 103 files / 798 tests passed |
| `./node_modules/.bin/vite build` | success (29.67 s; same warning) |

Not run: native Tauri commands, Windows WebView, NSIS/E2E, real screen reader,
high-contrast/zoom screenshots, perf profiling. No user data was used.
