# Full application audit matrix

For every row, record: inspected files, scenario, expected behavior, actual behavior, evidence, issue IDs, test added, and status.

## A. Baseline and architecture
- [ ] Git status and uncommitted work recorded; no user changes overwritten.
- [ ] Package scripts, dependency versions, Tauri config, Rust commands, capabilities and supported OS identified.
- [ ] Existing tests, test fixtures, logs and known failures inventoried.
- [ ] Main routes, state stores, persistence repositories and event subscriptions mapped.
- [ ] No production behavior inferred from `dist/` when source is available.

## B. Launch, shell and navigation
- [ ] First launch, returning launch, onboarding completion, interrupted onboarding.
- [ ] Reopen-last setting; opening reader from Library, Collections, Notes, search and external file.
- [ ] Back/close returns to correct origin and selected collection.
- [ ] Sidebar navigation while modal/panel/reader is active.
- [ ] Window resize, maximize/restore, fullscreen, display scaling and minimum dimensions.
- [ ] Error boundary recovery and startup failure messaging.

## C. Library and import
- [ ] Import one valid EPUB, PDF, article/clip if supported, unsupported file, corrupt file and oversized/malicious archive fixture.
- [ ] Multi-file and folder import, drag/drop, OS open-with and second-instance handoff.
- [ ] Duplicate import, duplicate content with different filename, interrupted import, cancel and retry.
- [ ] Cover fallback, long title/author, missing metadata, unusual Unicode and RTL metadata.
- [ ] Search, filters, sort, progress sort, last-read label and large library virtualization.
- [ ] Delete/undo, permanent delete, storage cleanup and empty/loading/error states.
- [ ] Import progress and actionable failure recovery.

## D. Reader: EPUB and PDF separately
- [ ] Open, load progress, parse failure, empty/invalid document, close during load, rapid open A then B.
- [ ] First/last page, previous/next, TOC, chapter boundaries, internal/external links.
- [ ] Resume after normal close, crash simulation, app restart, backup/restore and document reimport.
- [ ] Progress consistency: locator, percentage, chapter, page count, completion state and time remaining.
- [ ] Text selection, selection toolbar, highlight colors, underline, note add/edit/delete, annotation activation.
- [ ] Footnotes/noterefs, quote matching, anchored jump and cross-references.
- [ ] In-book search, no results, repeated query, navigation between hits, close/reopen panel.
- [ ] Context menu, pointer activity, chrome auto-hide/reveal, focus mode and line-focus mode.
- [ ] Keyboard shortcuts, browser/webview reserved keys, input focus guards and modifier combinations.
- [ ] Appearance: theme, font, size, line height, letter spacing, margins, max width, paragraph spacing.
- [ ] EPUB flow/spreads/publisher colors; PDF fit-width/fit-page/zoom/page layout/pan/thumbnail behavior.
- [ ] Selection and navigation while zoomed; page rotation or unusual page sizes if supported.
- [ ] Reader panel open/close, dock scrubbing, keyboard scrub, seeking and chapter marks.
- [ ] OS theme changes while app is open; per-book override/reset and persistence.
- [ ] Reader destroy/unmount: no orphan listeners, timers, workers, observers or keep-awake lock.

## E. Collections, notes, insights
- [ ] Create/rename/delete collection; case-insensitive uniqueness, whitespace, max length and duplicate validation.
- [ ] Add/remove books, empty collection, deleted book membership, return-to-origin behavior.
- [ ] Notes/highlights filters, color filter, search, sort, grouping, edit, delete, export.
- [ ] Deleted/missing source book behavior; annotations with no chapter metadata.
- [ ] Reading log day boundaries/time zones, streaks, goal, top books and zero-data state.
- [ ] Data refresh after import, delete, restore and reader activity.

## F. Settings, backup and recovery
- [ ] Theme/system theme, contrast, locale, UI zoom, shortcuts and reopen-last settings.
- [ ] Reader defaults vs per-book preferences and reset.
- [ ] Backup creation, invalid archive, version compatibility, preview/inspection, restore cancellation and failure.
- [ ] Atomic writes, lock handling, interrupted process, disk full/read-only path and permission denied.
- [ ] Rolling backup retention and restore reindex correctness.
- [ ] Update check/download/install failure and restart behavior.

## G. UI/UX and rendering
- [ ] Shared typography scale, font weights, line heights and text contrast.
- [ ] Shared spacing, alignment, radius, borders, elevation, focus ring and icon sizing.
- [ ] Screen title/header rhythm, action placement, content width and scroll ownership.
- [ ] Buttons, chips, rows, menus, dialogs, popovers, skeletons, empty/error states.
- [ ] Hover, active, selected, disabled, loading, success, warning and destructive states.
- [ ] Long text, narrow window, 125/150/200% UI zoom, light/dark/high contrast.
- [ ] Scrollbars, nested scrolling, sticky headers/footers, clipping and stacking contexts.
- [ ] Keyboard-only navigation, focus visibility, focus return, screen reader labels and reduced motion.
- [ ] No controls hidden behind title bars, dock, panels or OS window chrome.

## H. Performance and reliability
- [ ] Startup time, import throughput, large-library scroll, large EPUB open, large PDF open.
- [ ] Memory growth after repeated open/close and search/index operations.
- [ ] Worker failure/restart, cancellation and stale result handling.
- [ ] React rerender hotspots, expensive derived values and unnecessary full-library reloads.
- [ ] Long tasks, unhandled rejections, console errors and Rust logs.
- [ ] Performance scripts run with documented fixture sizes and machine conditions.

## I. Security and data safety
- [ ] ZIP traversal, decompression limits, malformed EPUB/PDF and HTML sanitization.
- [ ] External links and file paths constrained to intended behavior.
- [ ] Tauri command permissions/capabilities least-privilege.
- [ ] No secrets or document content leaked in logs.
- [ ] Backup integrity and restore path validation.

## Baseline audit coverage appendix (2026-11-28, commit `ed7a3a1`)

The checkboxes above remain unchecked because the matrix expects per-scenario
runtime evidence. This appendix records what the baseline audit actually
covered. "Source" = deterministic code inspection; "Test" = existing or
disposable automated test; "Runtime" = reproduced in a disposable profile.

| Area | Coverage | Evidence / issue IDs |
|---|---|---|
| A Baseline and architecture | Test + Source | `BASELINE.md`; 776/776 Vitest, tsc/eslint/build/foliocore green; no tracked changes |
| B Launch, shell, navigation | Source | Route/store map verified; boot, onboarding, sidebar, shortcuts, error boundary reviewed; SHELL-001/004/005, UI-001/004/005 |
| C Library and import | Source + Test | Import paths, dedup, covers, validation reviewed; IMPORT-001..006; tests `import*.test.ts` green |
| D Reader EPUB/PDF | Source + Test | Full lifecycle traced separately per format; READ-001..018; tests `reader*.test.ts`, `pdf*.test.ts` green; no runtime window (Linux) |
| E Collections, notes, insights | Source | Reviewed; UI-011, UI-012, DATA-004; tests `notesScreen`, `collectionsName`, `insightsScreen` green |
| F Settings, backup, recovery | Source + Runtime | DATA-001 reproduced at runtime via disposable Vitest; DATA-002..011; `backup*.test.ts` green |
| G UI/UX and rendering | Source | UI-002..018, DS/UI-018; CSS token reference grep; no window screenshot on Linux |
| H Performance and reliability | Test only | No perf script run; worker/pending maps and cleanup reviewed; READ-001/005 suspected |
| I Security and data safety | Source + Test | Path guard 14/14 foliocore tests; sanitizer/ZIP limits/CSP reviewed; NAT-001..005 |

Not exercised (documented blind spots): native Tauri commands at runtime, real
Windows WebView rendering, full NSIS build/install, E2E WebDriver smoke, real
user documents, live perf profiling, actual screen-reader session, and
high-contrast/UI-zoom screenshots. These are not claimed as passing.
