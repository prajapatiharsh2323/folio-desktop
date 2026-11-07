# Current Session Checkpoint

**Session:** `S-20261103-01` — Release Audit Baseline, Critical Safety, Search Lifecycle & UI Polish
**Updated:** 2026-11-03
**Status:** Phase 0 Audit complete, critical issues resolved and verified across 216 tests. Audit record: [`R-20261103-01`](audits/results/R-20261103-01-release-audit.md).
Previous record: [`S-20261101-02`](sessions/S-20261101-02-reader-redesign.md), [`S-20261031-06`](sessions/S-20261031-06-windows-manual-verification.md).

## Completed Work (Release Finalization Phase 0 & Quick Wins)

1. **Phase 0 Baseline & Release Audit Established:**
   - Formal audit report [`R-20261103-01`](audits/results/R-20261103-01-release-audit.md) recording 6 identified issues with reproduction steps, severity, fixes, and regression test status.
   - Verified automated baseline on Windows host:
     - `tsc -b`: clean exit 0.
     - Vitest: **216 passed / 23 files (100%)** (up from 211 / 22 files).
     - `vite build`: production bundle clean in 2.71s.
     - `cargo test --all-targets`: **23 passed / 0 failed** in 15.9s.
     - `cargo fmt --all -- --check`: clean.
     - `pnpm perf`: 189 ms reader parse (budget ≤ 1200 ms), 0.12 ms locator decode (budget ≤ 400 ms).

2. **Search Index Lifecycle & Performance (ISSUE-REL-001):**
   - Eliminated redundant publication unzipping, HTML stripping, and index re-building on every query in `readiumEngine.ts`.
   - Index is built lazily once via `getSearchIndex()` and reused across subsequent searches.
   - Cleared cleanly in `ReadiumEngine.destroy()`.
   - Regression test in `tests/reader.test.ts`.

3. **Multi-Selection Deletion Safety (ISSUE-REL-002):**
   - Added `deleteConfirmOpen` modal confirmation dialog to `LibraryScreen.tsx`.
   - Prevents accidental, unrecoverable book deletion during multi-selection.
   - Matched patterns used in `CollectionsScreen` and `NotesScreen`.

4. **Custom Scrollbar System (ISSUE-REL-003):**
   - Centralized modern slim scrollbars in `src/styles/base.css` using `scrollbar-width: thin`, `scrollbar-color`, and `::-webkit-scrollbar` with pill thumb and hover transitions.
   - Replaced Windows WebView2's default clunky grey scrollbars.
   - Uses semantic tokens `--folio-border` and `--folio-text-muted` without breaking frozen token map contracts.

5. **FolioButton Size Variants (ISSUE-REL-004):**
   - Added `size?: "default" | "sm"` to `FolioButtonProps` and `.folio-btn--sm` (36px height, compact padding) to `components.css`.
   - Allows compact actions in banners and dialogs without overriding global 50px default.
   - Unit tests added in `tests/releaseEnhancements.test.tsx`.

6. **Reader Lifecycle & Cleanup (ISSUE-REL-005):**
   - Added `.clear()` for all callback `Set` collections (`locatorCbs`, `selectionCbs`, `linkCbs`, `clickCbs`, `contextMenuCbs`, `pointerCbs`) on engine teardown in `readiumEngine.ts`.

7. **Keyboard Escape Navigation (ISSUE-REL-006):**
   - Pressing `Escape` inside the Library search input now closes the search bar and clears the query.
   - Pressing `Escape` in Library multi-select mode exits selection mode.

8. **Custom Cover Art System for Books & Collections:**
   - Bundled 5 cover images into `desktop/src/assets/covers/`.
   - Created centralized registry `desktop/src/lib/coverPresets.ts` with deterministic hash-based selection (`getBookCoverPreset`, `getCollectionCoverPreset`).
   - Wired `coverUrl` into `LibraryRow` and `LibraryScreen.tsx`, enabling rich book covers in `FolioBookRow` with fallback to preset art.
   - Updated `readerStore.ts` with preset fallback for reader splash and safe blob URL revocation.
   - Transformed Collections gallery and detail in `CollectionsScreen.tsx` with a distinct landscape banner cover style (`.folio-collection-card__banner`, `.folio-collection-hero`), gradient scrim, and badge pill.
   - Added unit test suite `tests/coverPresets.test.ts` (all 221 tests passing across 24 test suites). Verified clean `tsc -b` and `vite build`.

9. **Reader Top Bar Clearance & Appearance Tray Alignment / Hyphenation:**
   - Fixed reader top bar covering book content: bounded `.folio-reader__canvas` to `top: 56px` and `bottom: 24px` (expanding to `top: 0; bottom: 0` in focus mode) so text is never obscured by the top bar or dock.
   - Brought "Justify text" and "Hyphenate" into the "Quick Adjustments" tray and added a dedicated "Alignment & hyphenation" section right next to Text Size and Line Spacing in `AppearancePanel.tsx`.
   - Fixed panel color contrast bug by setting `color: var(--folio-text-primary)` on `.folio-panel` and `.folio-toggle-row`, preventing text from washing out in dark reading themes.
   - Added unit tests in `tests/appearancePanel.test.tsx` (all 222 tests passing across 24 suites). Clean `tsc -b` and `vite build`.

## Exact Next Action

1. Execute release candidate installer build: `pnpm tauri:build` on Windows.
2. Launch and smoke-test the built NSIS installer executable outside development environment.
3. Commit/push only with user approval (per AGENTS.md git safety).
