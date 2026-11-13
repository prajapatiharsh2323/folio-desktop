# Current Session Checkpoint

**Session:** `S-20261113-01` — Production-readiness Phase 1 + Phase 2 Step 2.0
(P0 blockers, quick wins, and the E2 reader refactor from the 2026-11-12
report; plan at `~/.opencode/plan/folio-production-readiness.md`)
**Updated:** 2026-11-13
**Status:** Phase 1 complete; **Phase 2 Step 2.0 (E2 reader refactor) complete**
— `ReaderScreen.tsx` split from 1,557 → ~870 lines into `src/screens/reader/`
hooks (`useReaderEngine`, `useReaderChrome`, `useAnnotations`, `useReaderKeyboard`,
`useInBookSearch` + `decorations.ts`, `keyGuards.ts`, `resumeTargets.ts`,
`launchExternal.ts`); stale `isFocusMode` closure fixed via `isFocusModeRef`;
all 16 `exhaustive-deps` warnings fixed by adding stable deps (refs/setters,
`docId` guards — never the `doc` object, whose identity changes on every
progress write); **zero `eslint-disable` remain for exhaustive-deps**.
ESLint 9 flat config + Prettier added (`eslint.config.js`, `.prettierrc.json`,
`.prettierignore`, `pnpm lint` / `pnpm format` / `pnpm format:check`); lint
passes with **0 errors / 0 warnings**, Prettier formatted (121 files; hex
pinned files excluded). Gates: `tsc -b` clean, **Vitest 331 / 331 (45 files)**,
`vite build` green, `prettier --check` clean. **Committed as `203f237` and pushed to
`origin/main` (2026-11-13, user-authorized).**
Windows runtime verification (grant flows, full Tauri `cargo test`, installer,
focus-mode/keyboard visual parity) remains blocked.

## Phase 2 · Step 2.0 (E2) — completed this pass

1. **Hook extraction** (behaviour-preserving; engine/chrome hook order and
   coordinator/modal-stack/mutex patterns kept): `useInBookSearch.ts`,
   `useReaderChrome.ts`, `useAnnotations.ts`, `useReaderKeyboard.ts` (full 07 §1
   matrix incl. Escape ladder), `useReaderEngine.ts`; helpers moved to
   `decorations.ts`, `keyGuards.ts`, `resumeTargets.ts`, `launchExternal.ts`.
   `engineRef`/`navRef` created in the screen and passed in; `chromeVisible`
   state lifted to the screen.
2. **ESLint/Prettier adoption:** flat config with `react-hooks` v7
   `recommended-latest` (compiler-purity rules `refs`, `set-state-in-effect`,
   `purity` off at config level with justification comments), `jsx-a11y`
   (`no-autofocus` off for modal fields), `typescript-eslint` recommended,
   `eslint-config-prettier`. Every remaining `exhaustive-deps` warning fixed in
   source; remaining a11y findings carry justified line-disables (reader-surface
   click canvas, dialog focus-trap containers, radiogroup roving tabindex,
   miniSearch Devanagari tokenize regex).
3. **Prettier format pass** (printWidth 100): 121 files reformatted; excluded
   `tests/fixtures/**` (byte-exact) and `src/styles/tokens.css` (pinned).
   **Incident + recovery:** the format pass lowercased hex values in
   `tokens.css`; an over-broad `git checkout` then discarded the uncommitted
   z-index/contrast token work. Recovered in full from (a) fixture
   `tests/fixtures/tokens.json` (values) and (b) the 13:58 `dist/` bundle
   (property order incl. `--folio-z-boot` and dark `--folio-scrim`); tokens
   test pins 109 light / 19 dark keys green again. `tokens.css` is now in
   `.prettierignore` so this cannot recur.

## Phase 1 — completed earlier in this session

1. **P0-4 handled failures:** `handleError(error, {context, userMessage?,
   details?})` + `describeError()` in `errorLog.ts`; swept user-facing catches
   in ReaderScreen (annotations/highlight/clipboard/bookmark/TOC callbacks —
   dialogs stay open with drafts on failure), NotesScreen, CollectionsScreen,
   LibraryScreen, SettingsScreen, libraryUi.ts, TocPanel, InBookSearchPanel,
   QuoteCard, fullscreen.ts. Expected control flow (e.g. "no index yet") stays
   silent; genuine failures log via `log_error`.
2. **P0-1 contrast:** dark tokens added (`--folio-on-accent #14201A`,
   `--folio-danger-container #3A2220`,
   `--folio-on-danger-container #F3C9C4`) + additive `--folio-border-control`
   (light `#8A897C`, dark `#748074`); wired into searchbar input, filter
   select, note textarea, in-book search field; contrast tests extended
   (button/snackbar AA pairs, 3:1 control borders). Kept decision
   A-UI-20261031-03 (muted stays decorative; functional labels use
   `--folio-text-secondary`). Fixture updated in the same change.
3. **P0-2 focus stealing:** FolioPanel/FolioDialog hold `onClose` in a ref and
   key the open/close effect on `[open]` only; `data-autofocus` on the in-book
   search input and both note textareas; `tests/focusStability.test.tsx`
   (5 tests) pins the regression.
4. **P0-3 error boundaries:** `shell/ErrorBoundary.tsx` (root + reader
   variants: reload / log folder / copy diagnostics / back-to-library); wired
   in `App.tsx` (root) and around ReaderScreen in `Shell.tsx`;
   `tests/errorBoundary.test.tsx` (5 tests).
5. **P0-5 path sandbox:** security core split into dependency-free
   `src-tauri/foliocore/` (appdir, guard, sandbox) so tests run on Linux;
   main crate re-exports. `guard_sandboxed()` = normalize → canonicalize
   (deepest existing ancestor; symlink/junction aliases collapse) → inside
   app dir or session-granted. Exact-path grants made only Rust-side:
   `pick_*` dialog commands (`commands/pick.rs`), DragDrop Drop handler
   (emits `folio://drop-granted` **after** granting), open-with launch args.
   Frontend rewired: `fileSource.ts` (`onDroppedFiles` listener, pick helpers),
   LibraryScreen/OnboardingFlow (webview event only drives over/leave
   visuals; files come from the granted event), SettingsScreen export/restore
   and QuoteCard save use the Rust pick commands (plugin-dialog JS API
   removed; `dialog:default` dropped from capabilities). fs/hash/zip commands
   use the guard; zip read has bomb caps (20k entries, 4 GiB total,
   2 GiB/entry, bounded read loop) + `rejects_paths_outside_the_sandbox` test
   proving `fs_delete` cannot remove outside paths. `zip` crate trimmed to
   deflate-only.
6. **Quick wins:** R7 icons (Copy/Share/EyeOff/Pencil added to FolioIcons;
   Copy button no longer shows a magnifier, Share no longer Info, Hide-controls
   no longer Toc, Edit-note no longer Notes); L6 toolbar "N of M documents"
   while filtered; E3 `core:window:allow-set-fullscreen`/`allow-set-title`
   permissions + setFullscreen rejection handling (logged, state reported);
   X3 z-index scale (`--folio-z-*`, 19 tokens, values unchanged) replacing
   every raw `z-index` in components.css/reader.css.

## Exact next action

1. Phase 2 **Step 2.1 (R1+R2+R3 search quality)** per the plan
   (`~/.opencode/plan/folio-production-readiness.md` lines ~125–167): shared
   `htmlToText()` utility (entity decode, block→space, skip script/style/head)
   with fixture coverage (`&amp;`, `&nbsp;`, `&#8217;`); per-occurrence
   in-book search with text-anchored locators and Next/Prev; MiniSearch
   upgrade (real `minisearch` package or cached DFs/precomputed TFs/prefix
   binary search, Web Worker, library indexing with progress).
2. Committing: Phase 1 + Step 2.0 committed as `203f237` and pushed to
   `origin/main` (2026-11-13, user-authorized). Continue committing per phase
   milestone with explicit authorization.
3. Windows-only proof still pending after Phases 1–2.0: real dialog/drop
   grant flows, full `cargo test --all-targets` for the Tauri crate,
   installer, focus-mode + keyboard visual parity after the refactor.

---

## Previous checkpoint — `S-20261109-01`

**Session:** `S-20261109-01` — Release finalization (Parts A–E)
**Updated:** 2026-11-09
**Status:** Parts A–D implemented and committed locally; Part E acceptance
report prepared. Linux verification green (**315 tests / 43 files**, `tsc -b`,
`vite build`, `pnpm perf`). Windows/Tauri runtime, installer, Narrator and
display-scaling checks remain unverified.

## Completed in this pass

1. **Part A — linear setup machine:** boot rules are explicit (no preferences →
   look; preferences without step 2 → library; existing documents or both flags
   → done), the step label comes from the machine, step 1 always clears the
   step-2 flag, and `window.__folioResetOnboarding()` is dev-only
   (`8325219`).
2. **Part B — two-screen setup:** full-bleed look/library screens, tour opt-in
   only, 200 ms cross-fade + 8 px slide, no scrollbar at 720×560, accessible
   radio groups and focus handling (`b8940f0`).
3. **Part C — review:** no High findings; fixed notes write safety, cached
   search rejection, non-Unicode argv panic, encoded OPF paths and restore
   total-budget bypass; eight Low items recorded in `FINDINGS.md` (`cfd496a`).
4. **Part D — release hardening:** article images restricted to `data:` and CSP
   `img-src` no longer allows `https:` (`1b3a183`); local rotating error log +
   Settings row (`a22bddc`); one-command version bump + drift test (`b21a9bb`);
   restored windows promoted to 720×560 (`e7958c4`); release checklist, root
   README, CHANGELOG 0.1.0, repo hygiene and search-field focus rings.
5. **Part E — acceptance:** Linux commands run end-to-end; Windows checklist
   consolidated in `docs/development/RELEASE.md` and the acceptance status
   recorded in
   [`audits/results/R-20261109-01`](audits/results/R-20261109-01-release-acceptance.md).

## Exact next action

1. On Windows: run the automated gate and installer checklist in
   `docs/development/RELEASE.md` (`tsc -b`, Vitest, `vite build`,
   `cargo test --all-targets`, `cargo fmt --all -- --check`, `pnpm tauri:build`).
2. Run the clean-profile and existing-library installer checks, including the
   error-log folder, opt-in tour, backup round-trip and off-screen restore.
3. Record the installer size and any signed/unsigned verdict in the release
   issue. Do not push without explicit authorization.

---

## Previous checkpoint — `S-20261108-01`

**Session:** `S-20261108-01` — Stabilization & polish pass (5 phases)
**Updated:** 2026-11-09
**Status:** All five phases implemented and committed locally. Automated half
of the Windows checklist (`MANUAL-TASKS.md` §8.0) executed **2026-11-09** and
green: `tsc -b`, **283 tests / 39 files**, `vite build`, `cargo test`
(23 passed / 0 failed), `cargo fmt`, `pnpm tauri:build` (NSIS installer
5 796 050 bytes) + build-tree smoke launch. Human-at-screen runtime checks
(§8.1–§8.9) remain pending.

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

1. ~~On Windows: run `pnpm exec tsc -b`, `pnpm exec vitest run`,
   `pnpm exec vite build`, then `cd src-tauri && cargo test --all-targets` and
   `cargo fmt --all -- --check`.~~ **DONE 2026-11-09** — all green; installer
   built and build-tree exe smoke-launched (see `MANUAL-TASKS.md` §8.0).
2. Runtime smoke (human at the screen, `MANUAL-TASKS.md` §8.1–§8.9): hidden-window launch (no white flash), first-run setup →
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
