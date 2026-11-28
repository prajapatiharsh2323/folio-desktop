# Suspected risks and unverified hypotheses — baseline audit 2026-11-28

These are **not** confirmed user-facing defects. Each entry has strong code
evidence or a plausible hypothesis, an explicit expected-vs-actual hypothesis,
a minimal proposed fix and a confirming test. Do not fix or close without
running the confirming test. `Root cause: not yet established` applies unless
the code path is deterministic.

---

## Reader lifecycle

### READ-001 — Engine `open()` is not cancellable
- Severity P1 · Confidence probable · `src/screens/reader/useReaderEngine.ts:321-374`,
  `src/reader/readiumEngine.ts:130-209`, `src/reader/pdfEngine.ts:119-250,1028-1058`
- Hypothesis: cleanup sets `cancelled` and calls `engine.destroy()`, but `open()`
  continues after its `await` and creates a navigator / listeners / pdf.js
  document bound to a torn-down canvas.
- Repro: mock engine whose `open()` resolves after `destroy()`; rapid open→Back
  during splash; assert no post-destroy listener/DOM/document creation.
- Expected: destroy aborts in-flight open. Actual hypothesis: orphaned state and
  stale callbacks.
- Fix: give engines a cancellation token checked after each await; have
  `destroy()` mark destroyed and make `open()` bail out before creating the
  navigator / re-registering listeners.
- Test: fake delayed engine + unmount; assert no mutations after destroy.

### READ-002 — Stale annotation refresh can paint the previous book
- Severity P1 · Confidence probable · `src/screens/reader/useAnnotations.ts:52-87`,
  `src/screens/reader/useReaderEngine.ts:339`
- Hypothesis: `refreshAnnotations(id)` paints through the live `engineRef.current`
  with no document-identity check; a refresh from book A resolving after book B
  opens paints A's highlights into B and shows A's annotations in the panel.
- Repro: two docs with delayed `listForDoc`; switch mid-flight; assert final
  decorations/list belong to B.
- Fix: capture the engine and doc id when starting the refresh, check both
  before painting; drop stale results.
- Test: two-doc delayed mock; assert no stale paint.

### READ-003 — Transient selection/popovers not cleared on document switch
- Severity P2 · Confidence unverified (normal UI unmounts the reader first) ·
  `src/screens/ReaderScreen.tsx:635-666`
- The reset effect clears ctx menu, quote selection and dialogs but not
  `selection`, `footnote`, `highlightPop`, `decorPopover`, `lineFocusOpen`.
- Hypothesis: a programmatic `openReader` while mounted leaves a stale quote
  toolbar; a live selection also suppresses edge page turns
  (`useReaderEngine.ts:269`).
- Fix: clear all transient UI state keyed on `docId + retryNonce`; reset the
  in-book search via its existing `reset()`.
- Test: invoke `openReader` while ReaderScreen is mounted with a live selection.

### READ-004 — PDF focus fullscreen is not exited on unmount / manual exit
- Severity P2 · Confidence probable · `src/screens/ReaderScreen.tsx:552-569,635-666`
- The effect requests fullscreen for `pdfPrefs.focusWorkspace` but has no
  cleanup; it depends on prefs and a stable callback, not on `chrome.isFocusMode`.
- Hypothesis: leaving the reader, or pressing `f` to leave focus mode while the
  pref stays true, leaves the window fullscreen with no chrome.
- Fix: request/exit fullscreen from the same state transition as focus mode and
  add an unmount cleanup that exits fullscreen only if this session requested it.
- Test: mount with `focusWorkspace:true`, unmount, assert
  `document.fullscreenElement === null`.

### READ-005 — Progress writes are not serialized
- Severity P2 · Confidence probable · `src/reader/progress.ts:82-122`,
  `src/store/readerStore.ts:164-190`
- `record()` awaits `persist` before updating `lastWritten`; overlapping
  locators can finish out of order, so an older snapshot wins and the reading
  log delta can be miscredited.
- Fix: chain writes through a promise tail (latest-wins) and update gate state
  from the newest snapshot.
- Test: delayed persist; two snapshots >0.4% apart; assert newest position.

### READ-007 — PDF search hits carry no anchor / active-match decoration
- Severity P2 · Confidence probable · `src/pdf/pdfSearch.ts:54-59`,
  `src/reader/pdfEngine.ts:773-777`, `src/screens/reader/useInBookSearch.ts:65-81`
- `useInBookSearch` paints the active decoration only when `hit.anchor?.quote`
  exists; PDF hits omit `anchor`. Fix: derive an anchor from the matched text
  and page for PDF hits. Test: select a PDF hit and assert an active decoration.

### READ-008 — `scrollStep` implemented but never called
- Severity P3 · Confidence probable · `src/reader/ReaderEngine.ts:216-217`,
  `src/reader/pdfEngine.ts:817-823`, `src/screens/reader/useReaderKeyboard.ts:140-161`
- Arrows always call `nav.next/previous`. Fix: route continuous-flow arrows to
  `scrollStep`. Test: ArrowDown on continuous PDF changes `scrollTop` by one step.

### READ-010 — Persisted PDF zoom appears ignored on open
- Severity P3 · Confidence unverified · `src/model/formatPrefs.ts:48,71`,
  `src/pdf/pdfSession.ts:87`, `src/reader/pdfEngine.ts:1002-1026`,
  `src/screens/ReaderScreen.tsx:403-407`
- May be intentional (zoom is session state). Confirm design intent first; if
  not, apply `PdfReaderPrefs.zoom` in `applyPdfPrefs`.

### READ-011 — Internal PDF link jumps twice / Back origin wrong
- Severity P2 · Confidence probable · `src/reader/pdfEngine.ts:468-472,794-800`,
  `src/screens/reader/useReaderEngine.ts:289-297`, `src/reader/navigation.ts:314-323`
- Engine both `jumpToPage()`s (emitting a locator) and fires `internalLinkCbs`,
  which routes a second `goToHref`; the coordinator's `getCurrentLocation()`
  then sees the destination as the origin. Fix: choose one path and record the
  origin before jumping. Test: click a PDF internal link, press Alt+Left.

### READ-012 — Direction / cover-first changes do not repaint layout
- Severity P2 · Confidence probable · `src/reader/pdfEngine.ts:1015-1025`,
  `src/pdf/pdfSession.ts:149-159`
- Setters null the layout but only rotation/pageSpacing set `relayout=true`.
  Fix: mark relayout for direction/cover-first and call `applyLayout`.
  Test: toggle RTL and assert page-box offsets change without scrolling.

### READ-013 — Thumbnail cache not keyed by document
- Severity P3 · Confidence unverified · `src/components/PdfThumbnailStrip.tsx:23-54`,
  `src/screens/ReaderScreen.tsx:1177-1184`
- Normal route changes unmount the strip, so reachability is limited. If the
  component is ever reused across docs, add a `key={docId}` or clear the cache.

### READ-014 — Canvas backing-store cap not reflected in render scale
- Severity P3 · Confidence probable · `src/pdf/pdfPageView.ts:214-226,352-362`
- Backing store shrinks over `MAX_BACKING_PIXELS` but render still uses
  `scale*dpr`. Fix: recompute effective scale after clamping. Test: stub
  renderer with tall page at high zoom.

### READ-015 — Session info double-counts current session
- Severity P2 · Confidence probable · `src/screens/ReaderScreen.tsx:1363-1364`,
  `src/components/ReadingSessionDialog.tsx:104-111`,
  `src/store/readerStore.ts:167-181`
- `pace.sessionsMs` already includes time credited/persisted this session;
  adding wall-clock `sessionDurationMs` again double counts. Fix: pass the
  persisted pace total (or subtract already-credited session ms).

### READ-016 — Footnote/highlight popovers do not hold chrome open
- Severity P3 · Confidence probable · `src/screens/ReaderScreen.tsx:287-305`,
  `src/screens/reader/useReaderChrome.ts:121-148`
- `holds` omits `footnote` and `highlightPop`; chrome can auto-hide under an
  open popover. Fix: add a `popover` hold active while either is open.

### READ-017 — Noteref resolved against last reported locator
- Severity P2 · Confidence probable · `src/reader/readiumEngine.ts:613-624`
- Uses `this.lastLocator?.chapterHref` rather than the frame containing the
  anchor; preloaded/next frames may resolve against the wrong chapter. Fix:
  resolve the anchor's own frame href. Test: noteref in a preloaded frame.

---

## Data / persistence

### DATA-002 — Synced appearance prefs are documented as backed up but are not
- Severity P2 · Confidence probable · `src/lib/syncedPrefs.ts:1-9,20-27`,
  `src/lib/libraryPaths.ts:43-44`, `src/backup/backupService.ts:195-229`,
  `.docs/02-architecture-and-stack.md:61`
- `user/window.json` lives at `<appDir>/user/`, outside the backed-up library
  root; the code comments claim the opposite. Decide intent: either include a
  small settings file in the backup contract, or correct the misleading
  comments. Test: restore to a fresh root and check appearance keys.

### DATA-003 — Restored theme key does not repaint
- Severity P2 · Confidence probable · `src/lib/syncedPrefs.ts:91-107`,
  `src/theme/theme.ts:27-66`, `src/shell/useBoot.ts:95-101`
- Only zoom/contrast/locale are applied on restore; theme is written to
  localStorage after `initTheme()` already ran. Fix: call the theme setter /
  re-init after restore. Test: seed dark theme, init light, restore, assert
  `document.documentElement.dataset.theme === "dark"`.

### DATA-004 — Merge restore drops three additive user files
- Severity P2 · Confidence probable · `src/backup/backupService.ts:589-611,701-787`,
  `src/store/repos.ts:171-178`, `src/lib/libraryPaths.ts:35-39`
- `UserDataSnapshot` handles only annotations/progress/collections/doc-settings/
  settings; `reading-log.json`, `pdf-prefs.json`, `epub-prefs.json` are
  ignored in merge mode. Fix: extend snapshot + merge for those files.
  Test: merge restore with seeded reading-log and PDF overrides.

### DATA-005 — Global theme change stops affecting PDFs after seeding
- Severity P2 · Confidence probable · `src/store/pdfPrefs.ts:38-48`,
  `src/screens/SettingsScreen.tsx:411-423`, `src/model/formatPrefs.ts:108-116`
- Migration from legacy settings happens only once; later global theme changes
  update schema-1 settings but not `pdf-prefs.json`. Confirm intended
  precedence, then either re-migrate on global change or document the split.

### DATA-006 — Fire-and-forget flush on non-Back exits
- Severity P2 · Confidence probable · `src/screens/reader/useReaderEngine.ts:354-374`,
  `src/screens/ReaderScreen.tsx:686-699`, `src/store/readerStore.ts:164-166`
- `void writer.flush()` in cleanup and in beforeunload can be dropped if doc
  state clears first; `handleBack()` has the correct awaited path. Fix: await
  flush before clearing doc (route shortcuts need a shared close flow).

### DATA-007 — Slug collision resolution outside the write lock
- Severity P2 · Confidence probable · `src/store/libraryManager.ts:75-81`,
  `src/model/ids.ts:28-35`
- Slugs computed before `runExclusive`; concurrent `addDoc` calls could share a
  slug. Current UI queue serializes imports, so exposure is low. Fix: compute
  inside the lock. Test: `Promise.all([addDoc(a), addDoc(b)])`.

### DATA-008 — Recovery removal does not cascade user records
- Severity P3 · Confidence probable · `src/store/libraryManager.ts:360-373`,
  `src/store/libraryUi.ts:502-513`
- Damaged-doc cleanup only deletes folder/manifest row; normal deletion
  cascades index/annotations/progress/reading-log/collections/doc-settings.
  Fix: share one cascade routine. Test: seed damaged doc + records, assert no
  orphans.

### DATA-009 — Corrupt JSON silently replaced
- Severity P2 · Confidence probable · `src/store/jsonio.ts:6-17`, `src/store/repos.ts`
- Corrupt files log a diagnostic but return null; the next write overwrites
  them. Fix: quarantine or surface a recovery notice before rewriting. Test:
  seed malformed `progress.json`, assert quarantine/notice.

### DATA-010 — 500 ms mirror debounce can lose a synced pref on shutdown
- Severity P3 · Confidence probable · `src/lib/syncedPrefs.ts:43-55`, `src/lib/storage.ts`
- No flush-on-exit hook. Fix: flush pending mirror on `beforeunload`/close.

### DATA-011 — Progress repo double read / non-transactional upsert
- Severity P3 · Confidence probable · `src/store/repos.ts:101-116`, `src/lib/mutex.ts:20-37`
- `put()` reads all records, then reads the file again; interleaved writes can
  clobber. Fix: single read inside `runExclusive`. Test: two interleaved puts.

---

## Import / native

### IMPORT-002 — Import reports failure after commit — PROMOTED / FIXED
- **No longer open.** Reproduced and fixed in batch 5; see `issues/IMPORT-002.md`.
- Severity P2 · Confidence confirmed · `src/import/importService.ts`
- Commit happens before index write; a throw is returned as `refused`, so
  retry shows a duplicate dialog. Fix: index before commit or roll back on
  post-commit failure; never report `refused` after commit. Test: fail only
  `index/text/*` writes.

### IMPORT-003 — Replace deletes old folder before new commit — PROMOTED / FIXED
- **No longer open.** Reproduced and fixed in batch 5; see `issues/IMPORT-003.md`.
- Severity P1 · Confidence confirmed · `src/import/importService.ts`,
  `src/store/libraryManager.ts:75-108`
- Mid-replace failure can leave the manifest pointing at deleted files. Fix:
  commit new doc first, then delete old folder (or stage-and-swap). Test: fail
  a write during `addDoc` and assert original files resolve.

### IMPORT-004 — Duplicate resolution during onboarding may hang
- Severity P2 · Confidence unverified · `src/store/libraryUi.ts:577-583`,
  `src/screens/LibraryScreen.tsx:1588-1626,259`, `src/onboarding/OnboardingFlow.tsx:373-441`
- The only duplicate dialog lives in LibraryScreen; onboarding imports through
  the same queue. Fix: host the resolver at the shell level or add a cancel
  path. Test: two rapid identical drops during setup.

### IMPORT-005 — OPF hrefs with `../` / percent-encoding not normalized
- Severity P2 · Confidence unverified · `src/import/epubImporter.ts:65-69,86-87,105-106`
- Raw string concatenation/zip lookup skips such spine items/covers. Fix:
  resolve relative to OPF dir and decode URI. Test: EPUB with `../Text/ch1.xhtml`.

### IMPORT-006 — Folder-scan copy mislabels skipped dirs
- Severity P3 · Confidence confirmed (cosmetic) · `src/lib/folderImport.ts:91-94,122-126`,
  `src/screens/LibraryScreen.tsx:335-339`
- Hidden/skipped dirs counted as "could not be read"; "over 500" hardcoded.
  Fix: separate skipped from failed; use the configured limit in copy.

### NAT-001 — External-link scheme check case-sensitive
- Severity P3 · Confidence unverified · `src-tauri/src/commands/shell.rs:5-8`,
  `src/import/sanitize.ts:136`
- Sanitizer keeps `HTTPS://…`, Rust refuses it. Fix: case-insensitive prefix.

### NAT-002 — `opener:default` capability may be broader than needed
- Severity P2 · Confidence unverified · `src-tauri/capabilities/default.json:12`
- All real opener uses go through validating Rust wrappers. Fix: narrow to the
  specific permissions used or none. Test: webview `plugin:opener|open_path` on
  an ungranted path must fail.

### NAT-003 — Unused native commands widen IPC surface
- Severity P3 · Confidence confirmed (code smell) · `src-tauri/src/lib.rs:41-42`,
  `src-tauri/src/commands/zip.rs:77-95`
- No frontend caller; `zip_write` takes unvalidated entry names. Fix: remove if
  truly unused, or validate names and keep only if planned.

### NAT-004 — Updater public key placeholder
- Severity P2 · Confidence unverified · `src-tauri/tauri.conf.json:85-93`
- Signed update verification cannot succeed with
  `REPLACE_WITH_UPDATER_PUBLIC_KEY`. Fix: configure real key before enabling
  updates; check is user-initiated so no boot network request.

### NAT-005 — Drag/drop grants every dropped path
- Severity P3 · Confidence unverified · `src-tauri/src/lib.rs:118-131`,
  `src-tauri/src/open_files.rs:32-41`
- Grants include directories; session-scoped and read-only, so impact is low.
  Fix: grant only importable file paths.

---

## Shell / UI / accessibility

### SHELL-001 / UI-001 — Boot and onboarding outside ErrorBoundary
- Severity P2 · Confidence probable · `src/App.tsx:15-22`
- Boundary wraps only Shell/Tour; a render throw in BootSplash/OnboardingFlow
  blanks the window. Fix: wrap the whole App tree (retaining reader variant).

### SHELL-003 / UI-003 — Menu semantics incomplete — UI-003 KEYBOARD FIXED
- **UI-003 keyboard semantics are resolved in batch 7** (`FolioMenu` arrow/Home/End
  + roving tab); modal inerting/inert registration remains open as SHELL-004.
- See `issues/UI-003.md`.
- Severity P2 · Confidence confirmed (design inconsistency) ·
  `src/components/FolioMenu.tsx:62-87,95-105`, `ReaderChrome.tsx:214-298`,
  `ReaderContextMenu.tsx:55-83`
- `role="menu"` without arrow/Home/End navigation or modal inert registration.
  Fix: implement WAI-ARIA menu keys or use non-menu roles.

### SHELL-004 — Toolbars not inert under modal dialogs
- Severity P3 · Confidence probable · `src/shell/modalStack.ts:48-50`,
  `src/screens/LibraryScreen.tsx:833-851,980-1123`
- Inert selector covers `.folio-sidebar, .folio-screen, .folio-reader` but
  toolbars are siblings. Fix: add `.folio-toolbar` (and verify ancestor logic).

### SHELL-005 — Fullscreen class can desync
- Severity P3 · Confidence unverified · `src/lib/fullscreen.ts:10-13,24-73`,
  `src/shell/Shell.tsx:48-55`
- Class only tracks in-app toggles; native fullscreen changes make Escape exit
  unavailable. Fix: listen to `fullscreenchange`.

### UI-004 — RTL uses physical offsets
- Severity P2 · Confidence probable · `src/i18n/i18n.ts:144-149`,
  `src/styles/components.css:371-380,441-446`, `src/styles/base.css:57`
- No logical properties / `[dir=rtl]` rules; panels/sidebar/dialog close do not
  mirror. Fix: use `inset-inline-*` / logical border radii and verify with `ar`.

### UI-005 — Tour/menu coordinates under CSS zoom
- Severity P3 · Confidence unverified · `src/lib/uiZoom.ts:35-40`,
  `src/onboarding/Tour.tsx:55-65`, `src/components/FolioMenu.tsx:46-60`
- `getBoundingClientRect()` values compared to `window.innerWidth` while
  `<html>` has CSS `zoom`. Fix: account for zoom factor or use offset positions.

### UI-008 — Settings status feedback far from the changed control
- Severity P3 · Confidence confirmed · `src/screens/SettingsScreen.tsx:796-800`
- Single message after the Backup section; top-of-page toggles appear to do
  nothing for sighted users. Fix: per-section status or sticky status region.

### UI-009 — Icon button below touch target token
- Severity P3 · Confidence confirmed · `src/styles/tokens.css:56`,
  `src/styles/base.css:164-170`, `src/styles/reader.css:100-108`
- 40×40 (reader 42×42) vs 48px token. Fix: use the token or document pointer-only
  exception.

### UI-013 — Single-select groups use aria-pressed chips — FIXED
- **No longer open.** Resolved in batch 7 via `FolioRadioGroup`; see `issues/UI-013.md`.
- Severity P2 · Confidence confirmed (design inconsistency) ·
  `src/screens/SettingsScreen.tsx:611-665,683-740,757-765,995-1013`,
  `src/screens/LibraryScreen.tsx:1086-1121`, unused `FolioRadioGroup.tsx`
- Fix: use `FolioRadioGroup` for mutually exclusive choices.

### UI-014 — Combobox options are extra tab stops — FIXED
- **No longer open.** Resolved in batch 7 via `tabIndex={-1}`; see `issues/UI-014.md`.
- Severity P2 · Confidence probable · `src/components/CommandPalette.tsx:141-179`,
  `src/screens/LibraryScreen.tsx:855-890,945-962`
- `aria-activedescendant` + tabbable `role=option` buttons mix focus models.
  Fix: `tabIndex={-1}` on options or manage focus explicitly.

### UI-015 — Small pointer targets
- Severity P3 · Confidence confirmed · `src/styles/components.css:850-857,872-879,609-621`
- 22×22 colour filter, 16×16 row swatch, 24×24 snackbar close vs 48px token.

### UI-016 — Partial localization
- Severity P3 · Confidence confirmed (documented limit) · `src/i18n/i18n.ts:3-8`,
  dialogs/screens/toasts use literal English
- In `hi`/`ar`, shell chrome is translated while the rest stays English under
  `dir=rtl`. Either extend the catalogue or document/remove the partial locales.

### UI-017 — Nested interactive risk in FolioSettingsRow
- Severity P3 · Confidence latent · `src/components/FolioSettingsRow.tsx:21-26`
- Wraps an arbitrary interactive `control` inside a button when `onClick` is
  provided. Current callers avoid this; add a guard or render siblings.
