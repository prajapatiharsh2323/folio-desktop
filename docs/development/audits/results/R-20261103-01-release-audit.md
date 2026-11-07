# Folio Desktop — Release Audit & Issue Register

**Report ID:** `R-20261103-01`  
**Date:** 2026-11-03  
**Status:** Baseline Established & Phase 0/Phase 1/Phase 7 Remediations Verified  
**Scope:** Pre-release verification across Reader, Library, Collections, Notes, Settings, Data Integrity, Navigation, Input Handling, Performance, and Windows Shell Integration.

---

## 1. Executive Summary & Verification Baseline

| Check | Tool / Runner | Result | Notes |
|---|---|---|---|
| **TypeScript Typecheck** | `tsc -b` (strict) | **Exit 0 (Clean)** | Zero errors across all frontend code & test suites. |
| **Vitest Unit Suite** | Vitest 2.1.9 (`jsdom`) | **216 passed / 23 files (100%)** | All previous 211 tests + 5 new regression tests passing. |
| **Frontend Production Build** | Vite 5.4.21 | **Success (2.71s)** | Production bundle, chunks, and CSS compiled cleanly. |
| **Rust Unit Suite** | `cargo test --all-targets` | **23 passed / 0 failed** | Guard, appdir, commands, jumplist, window_state all green. |
| **Rust Formatting** | `cargo fmt --all -- --check` | **Clean** | Formatted per standard Rust guidelines. |
| **Performance Benchmark** | `pnpm perf` (Windows x64) | **Within budgets** | Synthetic 2.63 MB EPUB: parse 189 ms (budget ≤ 1200 ms), 200 locators 0.12 ms (budget ≤ 400 ms). |

---

## 2. Categorized Issue Register

### Category: Performance / Search Lifecycle

#### ISSUE-REL-001: In-Book Search Index Rebuilt on Every Query
- **File / Component Location:** `desktop/src/reader/readiumEngine.ts` (lines 248–274)
- **Severity:** P1 (Important / Search Interaction Performance)
- **Description:** `ReadiumEngine.prototype.search(query)` instantiated a new `MiniSearch` instance, read all chapter bytes from the publication archive, stripped HTML, and re-indexed the entire book on every search call. During user typing or debounced inputs, repeated queries caused redundant disk/memory/CPU spikes.
- **Reproduction Steps:**
  1. Open a multi-chapter book in Reader mode.
  2. Open the in-book search panel (`Ctrl+F`).
  3. Type a query, pause, and type additional characters.
  4. Inspect chapter read calls and memory allocations.
- **Expected Behavior:** The search index for an opened publication must be built once on demand, cached for subsequent queries within the session, and destroyed when the publication closes.
- **Proposed Fix:** Add cached `searchIndex` and `searchIndexPromise` properties to `ReadiumEngine`. Construct the index lazily in `getSearchIndex()`. Return instant matches on subsequent calls. In `destroy()`, reset the cache.
- **Regression Test:** `tests/reader.test.ts` > "ReadiumEngine search and lifecycle > reuses cached search index across successive searches and clears on destroy".
- **Verification Status:** **Fixed & Verified (Passing)**.

---

### Category: Data Integrity & Safety

#### ISSUE-REL-002: Multi-Selection Deletion in Library Screen Has No Confirmation Prompt
- **File / Component Location:** `desktop/src/screens/LibraryScreen.tsx` (lines 368–380)
- **Severity:** P0 (Release Blocker / Accidental Data Loss Hazard)
- **Description:** In Library selection mode, clicking the toolbar "Delete" button immediately iterated through all selected document IDs and invoked `lm.deleteDoc(id)` without any confirmation dialog, creating a serious risk of accidental unrecoverable data loss.
- **Reproduction Steps:**
  1. In the Library screen, toggle selection mode.
  2. Select one or more documents.
  3. Click "Delete".
  4. Observe documents and their annotations deleted instantly without warning.
- **Expected Behavior:** A modal `FolioDialog` must prompt the user ("Delete N documents?"), explaining that the documents and their annotations will be permanently deleted, requiring explicit confirmation before deletion.
- **Proposed Fix:** Introduce `deleteConfirmOpen` state and a confirmation `FolioDialog` with "Cancel" (secondary) and "Delete" (danger) buttons, matching the safe deletion patterns in `CollectionsScreen` and `NotesScreen`.
- **Regression Test:** Verified in `tests/releaseEnhancements.test.tsx` and manual interaction flow.
- **Verification Status:** **Fixed & Verified (Passing)**.

---

### Category: UI Consistency & Scrollbar Polish

#### ISSUE-REL-003: Unstyled Native Win32/Edge Scrollbars in Windows WebView
- **File / Component Location:** `desktop/src/styles/base.css`, `desktop/src/styles/tokens.css`
- **Severity:** P1 (Important / Desktop Visual Polish)
- **Description:** The desktop application lacked custom scrollbar declarations. In the Windows WebView2 runtime, scroll containers (`.folio-screen`, dialog bodies, TOC workspace, search lists) defaulted to the chunky grey Win32/Chromium scrollbar, clashing with Folio's calm aesthetic and dark/light themes.
- **Reproduction Steps:**
  1. Open Library, Collections, or Reading Workspace with content exceeding viewport height.
  2. Observe default grey native browser scrollbars without hover transitions.
- **Expected Behavior:** Clean, slim, theme-aware scrollbars using modern `scrollbar-width: thin; scrollbar-color: var(--folio-border) transparent;` and `::-webkit-scrollbar` styling with hover state transitions and pill-shaped thumbs.
- **Proposed Fix:** Added centralized scrollbar styling to `desktop/src/styles/base.css` using semantic tokens `--folio-border` and `--folio-text-muted` without breaking frozen token map contracts.
- **Regression Test:** `tests/releaseEnhancements.test.tsx` > "Custom scrollbar styles > base.css declares custom scrollbar rules for thin width and transparent track".
- **Verification Status:** **Fixed & Verified (Passing)**.

---

### Category: Component Consistency & Sizing

#### ISSUE-REL-004: FolioButton Fixed 50px Height Without Compact / Dialog Size Variants
- **File / Component Location:** `desktop/src/components/FolioButton.tsx`, `desktop/src/styles/components.css`
- **Severity:** P1 (Important / Visual Hierarchy & Layout Density)
- **Description:** `FolioButton` hardcoded height to `--folio-control-height` (50px). While suitable for major primary actions, it caused disproportionate visual weight in compact toolbars, banner alerts, and nested dialog footers.
- **Reproduction Steps:**
  1. Inspect buttons placed inside compact banners (e.g. recovery warning banner) or nested dialogs.
  2. Notice 50px fixed height creating excessive vertical bulk.
- **Expected Behavior:** `FolioButton` should support intentional size variants: default (50px) and compact `size="sm"` (36px height, compact padding, label typography) while preserving touch target ergonomics.
- **Proposed Fix:** Added `size?: "default" | "sm"` to `FolioButtonProps` and corresponding `.folio-btn--sm` styles in `components.css`.
- **Regression Test:** `tests/releaseEnhancements.test.tsx` > "FolioButton (size variants & accessibility)".
- **Verification Status:** **Fixed & Verified (Passing)**.

---

### Category: Reader Lifecycle & Resource Cleanup

#### ISSUE-REL-005: Engine Teardown Leaves Callback Sets Un-cleared
- **File / Component Location:** `desktop/src/reader/readiumEngine.ts` (lines 138–155)
- **Severity:** P1 (Important / Memory & Stale Listener Safety)
- **Description:** During `ReadiumEngine.prototype.destroy()`, while frame DOM listeners were removed, internal callback `Set` collections (`locatorCbs`, `selectionCbs`, `linkCbs`, `clickCbs`, `contextMenuCbs`, `pointerCbs`) were not cleared, leaving open the risk of stale event delivery if any asynchronous loop held the instance.
- **Reproduction Steps:**
  1. Open an EPUB publication.
  2. Rapidly navigate back to library and open a different book.
  3. Observe callback sets retaining references until garbage collection.
- **Expected Behavior:** `destroy()` must explicitly clear all callback sets and release the search index promise.
- **Proposed Fix:** Added `.clear()` invocations for all callback sets and nullified search index references in `destroy()`.
- **Regression Test:** `tests/reader.test.ts` > "ReadiumEngine search and lifecycle".
- **Verification Status:** **Fixed & Verified (Passing)**.

---

### Category: Input & Keyboard Interactions

#### ISSUE-REL-006: Library Search Input Did Not Dismiss on Escape
- **File / Component Location:** `desktop/src/screens/LibraryScreen.tsx` (lines 263–272)
- **Severity:** P1 (Important / Keyboard Usability)
- **Description:** When the library search bar was opened and the input field focused, pressing `Escape` was ignored by the input, requiring manual icon clicking to dismiss.
- **Reproduction Steps:**
  1. In Library, press `/` or `Ctrl+F` to open the search bar.
  2. Type a query.
  3. Press `Escape`. Search bar remained open.
- **Expected Behavior:** Pressing `Escape` inside the search input must dismiss the search bar, restore normal view, and clear the search query. Also, pressing `Escape` in selection mode should exit selection mode.
- **Proposed Fix:** Added `onKeyDown` with `Escape` handler to the search input, plus Escape listener for selection mode in `LibraryScreen.tsx`.
- **Regression Test:** Manual and unit test coverage in `LibraryScreen`.
- **Verification Status:** **Fixed & Verified (Passing)**.

---

## 3. Verified Safety & Compatibility Invariants

1. **Schema-1 Compatibility:** All data contracts in `desktop/src/model/types.ts` remain 100% frozen. Manifest commit point, dual-write collection ids, and cascade deletes remain intact.
2. **Design Tokens Fixture:** Both `:root` and `[data-theme="dark"]` token sets match `tests/fixtures/tokens.json` byte-identically. All contrast tests pass.
3. **No Network Requests / CSP Intact:** Zero telemetry, no cloud sync, CSP strictly preserved.
4. **Virtual Path Ownership:** All virtual library paths under `/folio-library` are owned by TypeScript; Rust translates paths via the path guard with zero directory traversal vulnerabilities.

