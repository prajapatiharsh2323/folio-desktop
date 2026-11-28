# Initial architecture map (derived from `desktop.md`)

## Product surface visible in the export
Folio is a desktop reading/library application built around a React/TypeScript frontend and a Tauri/Rust desktop shell.

### Main navigation/screens
- `src/shell/Shell.tsx`, `Sidebar.tsx`, `useBoot.ts`, `ErrorBoundary.tsx`
- `src/screens/LibraryScreen.tsx`
- `src/screens/CollectionsScreen.tsx`
- `src/screens/NotesScreen.tsx`
- `src/screens/InsightsScreen.tsx`
- `src/screens/SettingsScreen.tsx`
- `src/screens/ReaderScreen.tsx`

### Reader stack
- Engine contract/factory: `src/reader/ReaderEngine.ts`, `engineFactory.ts`
- EPUB: `readiumEngine.ts`, `epubPublication.ts`
- PDF: `pdfEngine.ts`, `src/pdf/*`, PDF.js assets under `dist/`
- Reader orchestration/hooks: `src/screens/reader/useReaderEngine.ts`, `useReaderChrome.ts`, `useReaderKeyboard.ts`, `useAnnotations.ts`, `useInBookSearch.ts`
- Reader UI: `ReaderChrome`, `ReaderDock`, `TocPanel`, `InBookSearchPanel`, `AppearancePanel`, `PdfAppearancePanel`, selection/annotation/footnote popovers and dialogs.
- Reader concerns visible in the interfaces include progress, locator/resume, TOC, links, selection, decorations, search, footnotes, pointer activity, context menus, zoom, page info, thumbnails, pan mode, and loading progress.

### Library and data
- `src/store/*`: library manager/repositories, reader state, route state, EPUB/PDF preferences, positions cache.
- `src/model/*`: defaults, format preferences, IDs, types.
- `src/backup/*`: backup schema/service, rolling backup, reindex, ZIP archive.
- `src/lib/*`: storage, paths, file source, folder import, lifecycle, mutex/write lock, reading log, search cache, updater, fullscreen, UI zoom, contrast, error logging.
- `src/import/*`: EPUB importer, article importers, sanitization, file detection, ZIP limits, cover extraction.
- `src/search/*`: index, worker, normalization, matching, occurrences.
- `src/onboarding/*`: boot splash, onboarding flow/state, preference editor, tour.

### Native shell
- `src-tauri/src/commands/*`: backup, filesystem, hash, logging, picker, power, shell, ZIP.
- `src-tauri/foliocore/*`: app directory, guard, sandbox.
- Tauri capabilities and generated schemas are present.

### Shared visual system
- Shared components: `src/components/Folio*.tsx`, popovers, dialogs, buttons, rows, panels, empty states, skeletons, menus, toast host.
- Styles: `src/styles/tokens.css`, `base.css`, `components.css`, `reader.css`, `pdf.css`.
- Theme/i18n: `src/theme/theme.ts`, `src/i18n/i18n.ts`.

### Quality/performance infrastructure visible
- `e2e/README.md`, `e2e/smoke.mjs`
- `scripts/perf.ts`, perf loader/register scripts
- synthetic EPUB/PDF fixtures under `src/perf/`
- `dist/` build output and Rust `target/` artifacts are included in the export tree.

## Architectural implications / audit seams
1. Reader engine is an abstraction boundary: test the same user journeys against EPUB and PDF capability sets.
2. Reader lifecycle is complex: open, progress, subscriptions, navigation, destroy, route changes, and window/app lifecycle need race and cleanup tests.
3. Persistence is distributed across repositories, storage helpers, caches, and backup code: verify a single source of truth and atomicity.
4. Multiple overlay systems coexist (modal stack, overlays, menus, popovers, reader chrome): test z-order, focus, Escape, click-outside, and inert behavior.
5. The reader has both global settings and per-book overrides: test precedence, reset, migration, and reopening.
6. Library import supports multiple sources (file picker, folder scan, drag/drop, open-with): verify consistent validation and error reporting.
7. Search has an index/worker/cache pipeline: verify stale-index recovery and document updates.
8. The shared component and CSS token layers are the natural place to resolve cross-screen inconsistency.

## Evidence limits
This map is based on the supplied project export. It does not prove every listed feature works, nor that the checked-in repository has not changed since export. Confirm all findings against current source and runtime.
