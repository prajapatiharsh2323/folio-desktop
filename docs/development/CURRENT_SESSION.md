# Current Session Checkpoint

**Session:** `S-20261108-01` — Stabilization & polish pass (5 phases)
**Updated:** 2026-11-08
**Status:** All five phases implemented and committed locally; Linux verification green (**283 tests / 39 files**, `tsc -b`, `vite build`). Windows/Tauri runtime checks pending.

## Completed in this pass

1. **Import and selection safety (S5, S6, G1, G2):** one process-wide import
   queue, per-file error handling, aggregate batch summaries with details, a
   global toast host (errors persist, successes expire after 4 s), Ctrl+A
   limited to visible rows, selection cleared on filter/search change, bulk
   delete that survives per-document failures, and authors-last sorting.
2. **Library and reader safety (G3, G4, S1):** Reader Back always navigates
   even when persistence fails; Tauri close requests flush progress (1.5 s
   cap) before destroy; progress flushes on visibility change; the window is
   hidden until the stored theme has been applied (Rust 1.5 s fallback).
3. **Boot and onboarding (S2, S3, S4):** booting splash, 1 s library probe,
   existing documents skip setup and tour, saved settings skip setup only,
   pending vs visible tour state, `useBoot` recovery/launch ordering, drops
   ignored under overlays.
4. **Onboarding and appearance polish (O1–O8):** short-window layout and
   sticky actions, live app-theme preview with revert, reading→app theme
   linking, "Use defaults" copy, save timeout and load warning, accessible
   radio groups everywhere, real-size/publisher-aware preview, focus trap,
   step label and reflowing swatch grid.
5. **Tour redesign and modal stack:** spotlighted anchors, safe session-only
   dismissal with a replay hint, inert shell and per-step focus, origin
   restore, and last-opened-wins Escape/Tab handling for stacked surfaces.
6. **Remaining audit items (G5–G8):** cached library search index and custom
   cover URLs, collections sort/restore polish and global error toasts, real
   app version from `package.json`, pace-before-coordinator ordering, and the
   Tauri window label renamed to `main`.

## Exact next action

1. On Windows: run `pnpm exec tsc -b`, `pnpm exec vitest run`,
   `pnpm exec vite build`, then `cd src-tauri && cargo test --all-targets` and
   `cargo fmt --all -- --check`.
2. Runtime smoke: hidden-window launch (no white flash), first-run setup →
   tour spotlight/escape, reader close flush, import queue under overlays,
   collections round-trip, cover cache after replacing a cover.
3. Commit/push only with explicit authorization (local commits already made).

---

## Previous checkpoint — `S-20261107-01`

**Session:** `S-20261107-01` — Cleanup & UX Pass (onboarding, Settings, Library, search, resilience)
**Updated:** 2026-11-07
**Status:** Implementation complete; Linux verification green (**238 tests / 28 files**, `tsc -b`, `vite build`). Windows/Tauri verification pending. Changes uncommitted. Record: [`S-20261107-01`](sessions/S-20261107-01-cleanup-ux-pass.md).
Previous record: [`S-20261103-01`](#previous-checkpoint--s-20261103-01), [`S-20261101-02`](sessions/S-20261101-02-reader-redesign.md).

## Completed Work (Cleanup & UX Pass)

1. **First-run onboarding + five-step tour** (`src/onboarding/`):
   - Preference setup on a fresh install: app appearance, reading theme,
     typeface, text size; saved through the existing global `ReadingPrefs`
     repository with unknown keys preserved.
   - Separate persisted flags for setup vs tour (`folio.onboarding.prefs-complete`,
     `folio.onboarding.tour-complete`); closing mid-tour resumes the tour.
   - Tour is skippable, Escape/backdrop dismissable, focus-trapped, route-aware,
     and replayable from Settings.
   - "Skip for now" writes no preference. App appearance is a draft until Save.
2. **Settings consolidation:** one "Default reading preferences" dialog using
   the same editor as onboarding; app appearance remains a single control; tour
   replay row; library-folder open is disabled outside Tauri and reports errors.
3. **Library cleanup:** removed sidebar wordmark, inert Sort/More icons,
   placeholder chips, and duplicate Import; one toolbar shown only when rows
   exist; exactly one visible import entry per state.
4. **Semantic rows:** `FolioBookRow` and Notes rows are real buttons with
   sibling action controls (no nested interactive elements); the optional "…"
   action renders only when a handler exists.
5. **Search correctness:** snippets HTML-escape book text before `<mark>`;
   results show the document title once with the chapter as secondary text;
   chapter `href` is persisted in text indexes (import + reindex) with a
   `meta.json` fallback for old indexes; results open at the chapter location.
6. **Resilience/a11y:** retry + error states for Library, Notes, and
   Collections; filter-aware empty copy; safe Web Storage wrapper; StrictMode-safe
   theme listener; cover object-URL revocation after commit; global shortcuts
   gated under overlays and while typing; Library/Notes shortcuts respect
   `contenteditable`.

## Verification (Linux)

- `./node_modules/.bin/tsc -b` — clean.
- `./node_modules/.bin/vitest run` — **238 passed / 28 files** (16 new tests:
  onboarding state, snippet escaping, locator navigation, book-row semantics).
- `./node_modules/.bin/vite build` — success (existing chunk-size warning only).
- Rust/Tauri build and runtime checks were not run on this Linux host.

## Exact next action

1. On Windows: `cd desktop && pnpm install && pnpm exec tsc -b && pnpm exec vitest run && pnpm exec vite build`, then `cd src-tauri && cargo test --all-targets`.
2. Runtime smoke: first-run setup → tour → Settings replay; search result opens
   at the chapter; Library/Notes/Collections retries; overlay shortcut gating;
   cover URLs after re-import.
3. Do not commit/push without explicit authorization.

---

## Previous checkpoint — `S-20261103-01`

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
