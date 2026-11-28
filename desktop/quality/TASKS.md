# Current task queue

Phase: **baseline audit complete; remediation batches 1–7 fixed and verified.**

## Done (this audit)
- [x] Read `AGENTS.md`, `quality/README.md`, all four `.opencode/skills/*/SKILL.md`,
      and the baseline audit prompt.
- [x] Record git status (`main` @ `ed7a3a1`, no tracked changes) and preserve the
      untracked audit workspace.
- [x] Discover real package scripts; install from frozen lockfile with pnpm 11.
- [x] Run baseline: `tsc -b`, Vitest (776/776), ESLint, `vite build`, Vite dev
      server HTTP check, `cargo test -p foliocore` (14/14). Record results in
      `reports/BASELINE.md`.
- [x] Compare current source with `quality/analysis/*` and map routes/screens,
      state stores, persistence and native commands.
- [x] Execute the audit matrix across all eight areas and read the reader, data,
      import/search/native and UI/a11y subsystems in depth.
- [x] Reproduce DATA-001 at runtime with a disposable synthetic test; remove
      the test and re-verify clean `git status`.
- [x] Create `reports/ISSUE-REGISTER.md`, detailed confirmed issue reports in
      `reports/issues/`, `reports/SUSPECTED-RISKS.md`, and the prioritized roadmap.

## Done — remediation batches 1–6
- [x] Batch 1: UI-002, UI-006, UI-011, UI-012 (5 RED → 29 GREEN; 781 tests).
- [x] Batch 2: DATA-001 (1 RED → 9 GREEN; 782 tests).
- [x] Batch 3: SEARCH-001, IMPORT-001 (3 RED → 38 import tests; 785 tests).
- [x] Batch 4: SEARCH-002, READ-006, READ-018 (4 RED → 69 focused; 789 tests).
- [x] Batch 5: IMPORT-002, IMPORT-003 (2 RED → 43 focused; 791 tests).
- [x] Batch 6: UI-018 (2 RED → 5 focused; 793 tests).

## Done — remediation batch 7
- [x] UI-007: “Delete everything” switched to the danger variant; assertion
      added to the existing settings reset test.
- [x] UI-013: single-select Settings groups and Library search-scope/kind
      filters converted to `FolioRadioGroup` (radiogroup/radio/aria-checked,
      one tab stop, arrow keys).
- [x] UI-014: `tabIndex={-1}` on `role="option"` buttons in CommandPalette and
      Library search results.
- [x] UI-003 (keyboard semantics): `FolioMenu` gained Arrow/Home/End navigation
      and a roving tab stop. Modal inerting remains SHELL-004.
- [x] Full gate 103 files / 798 tests, tsc 0, ESLint 0, Vite build success;
      register, four new issue detail files, test matrix, suspected-risk
      register, roadmap and this handoff updated.

## Now (next agent / session)
- [ ] Manual keyboard/screen-reader/UI/screenshot checks on a Windows host for
      batches 1–7 (Linux host cannot run the native window).
- [ ] Remaining suspected risks: SHELL-004 (toolbar inerting under modals),
      READ-001/READ-002/READ-005 (lifecycle/progress races) — reproduce before
      fixing.
- [ ] UI-016/UI-017/UI-004/UI-005 (i18n coverage, nested control, RTL/zoom
      geometry) — verify reachability, then decide scope.

## Next
- [ ] Reading UX/visual pass with before/after screenshots at normal and narrow
      window sizes, light/dark/high contrast.
- [ ] Windows-only verification on a Windows host for Tauri build and E2E smoke;
      never claim those passed from this Linux baseline.

## Session handoff
- Last completed: remediation batch 7 — UI-003 (keyboard), UI-007, UI-013,
  UI-014 fixed and verified; batches 1–6 already fixed and verified
- Current branch/commit: `main` / `ed7a3a1` (changes uncommitted, not pushed)
- Files changed:
  - `src/components/FolioPanel.tsx`, `src/components/SelectionToolbar.tsx`,
    `src/components/CommandPalette.tsx`, `src/components/FolioMenu.tsx`
  - `src/screens/SettingsScreen.tsx`, `src/screens/CollectionsScreen.tsx`,
    `src/screens/NotesScreen.tsx`, `src/screens/ReaderScreen.tsx`,
    `src/screens/LibraryScreen.tsx`
  - `src/store/libraryManager.ts`, `src/lib/searchCache.ts`,
    `src/import/importService.ts`, `src/import/clip/epubBuilder.ts`,
    `src/pdf/pdfIndexJob.ts`, `src/backup/reindex.ts`, `src/pdf/pdfSession.ts`
  - styles/fixture: `src/styles/tokens.css`, `src/styles/components.css`,
    `tests/fixtures/tokens.json` (deliberate `--folio-focus` addition)
  - tests: 15 modified/new test files, including new
    `collectionDialogA11y.test.tsx`, `importReplace.test.ts`,
    `cssTokenRefs.test.ts`, `folioMenu.test.tsx`
  - docs: `quality/**` (issue register, 16 issue reports, test matrix,
    suspected-risk register, roadmap, baseline audit, this handoff)
  - No package/lockfile change; no setting or user-data change
- Tests run: RED→GREEN across batches 1–7; full `vitest run` 798/798 (103 files);
  `tsc -b` 0; ESLint 0; Vite build success. Baseline: foliocore 14/14,
  dev-server HTTP OK.
- Closed issue IDs: DATA-001, IMPORT-001/002/003, SEARCH-001/002, READ-006/018,
  UI-002/003(keyboard)/006/007/011/012/013/014/018
- Open issue IDs: SHELL-004 plus entries in `SUSPECTED-RISKS.md`
- Next exact action: add a failing test for SHELL-004 (toolbars remain
  interactive under a modal dialog) and extend the inert selector if reproduced
- Risks / do-not-touch areas: Schema-1 frozen fields; manifest written last;
      TS-owned `/folio-library` paths and Rust guard; byte-pinned fixtures and
      `tokens.json` (changed deliberately in batch 6); no telemetry/network;
      preserve user data; never discard uncommitted work or commit/push without
      authorization.
