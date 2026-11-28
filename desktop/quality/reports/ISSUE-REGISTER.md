# Issue register — baseline audit 2026-11-28

Commit `ed7a3a1`, branch `main`. Classification and confidence are kept
separate: **confirmed** = reproduced at runtime or proven by deterministic
code/CSS inspection; **probable** = strong code evidence, user-facing
reproduction still pending; **unverified** = plausible hypothesis only.
Severity follows `../README.md`. Full detail for confirmed defects is in
`reports/issues/`; all hypotheses are grouped in `reports/SUSPECTED-RISKS.md`.

Remediation batches 1–7 (2026-11-28) fixed and verified: batch 1 — UI-002,
UI-006, UI-011, UI-012 (including the reader note editor); batch 2 — DATA-001;
batch 3 — SEARCH-001, IMPORT-001; batch 4 — SEARCH-002, READ-006, READ-018;
batch 5 — IMPORT-002, IMPORT-003 (promoted to confirmed by failing-FileStore
tests); batch 6 — UI-018; batch 7 — UI-003 (keyboard semantics), UI-007,
UI-013, UI-014. All other entries remain open.

## Confirmed defects (ranked P0 → P3)

| ID | Classification | Severity | Confidence | Area | Summary | Reproduction / evidence | Detail | Status |
|---|---|---|---|---|---|---|---|---|
| — | — | P0 | — | — | No P0 defect confirmed in this audit | No data-loss/corruption, launch failure or security-boundary failure reproduced | — | — |
| DATA-001 | confirmed defect | P1 | confirmed | Library / backup | Editing a book's details left the manifest `meta.json` hash stale; that library's own backup failed to restore | Runtime repro: `addDoc` → `updateMeta(id,{title})` → manifest SHA ≠ disk SHA; `restoreBackup` threw `A file for “Renamed Book” failed its checksum.` (`libraryManager.ts:154-175`; `backupService.ts:444-461`); fixed by refreshing the `meta.json` file entry before the manifest commit | `issues/DATA-001.md` | **Fixed & verified** — `tests/libraryManager.test.ts` (new test asserts size/hash and backup restore) |
| SEARCH-001 | confirmed defect | P2 | confirmed | Import / search | Newly imported PDFs were not indexed until the app restarts, so library search omitted them | `importService.ts` skipped the PDF index and never enqueued the background job; now `enqueueIndex(meta.id)` runs after commit in both `importFile` and `replaceDoc` | `issues/SEARCH-001.md` | **Fixed & verified** — `tests/importPdf.test.ts` (2 new tests) |
| IMPORT-001 | confirmed defect | P2 | confirmed | Import / EPUB builder | Inline `data:` images in clipped HTML were referenced by the generated EPUB but never written into it | `buildEpub()` now takes `imageBytes` and writes `OEBPS/images/<name>` entries; `importService` passes extracted bytes | `issues/IMPORT-001.md` | **Fixed & verified** — `tests/import.test.ts` (new test unzips `reading/book.epub`) |
| READ-006 | confirmed defect | P2 | confirmed | Reader / PDF rights | No-copy PDFs no longer offer citation copy or share-as-image | `SelectionToolbar.tsx` now applies `copyDisabled` to all three extraction buttons; `ReaderScreen.tsx` still passes `capabilities.noCopy` | `issues/READ-006.md` | **Fixed & verified** — `tests/citationShare.test.tsx` (new test) |
| READ-018 | confirmed defect | P2 | confirmed | Reader / PDF progress | Last PDF page now reports 100%, so the end-of-book card is reachable by reading | `PdfSession.progression()` returns 1 on the final page; center-based `progressionForPage` retained for scrubbing | `issues/READ-018.md` | **Fixed & verified** — `tests/pdfSession.test.ts` (new test) |
| UI-002 | confirmed defect | P2 | confirmed | Reader panels / keyboard | Non-modal docked panels trap Tab even though the canvas is meant to stay interactive | `FolioPanel.tsx:41-52` skipped modal registration but `:91` unconditionally installed `trapTabKey`; fixed by gating on `modal` | `issues/UI-002.md` | **Fixed & verified** — `tests/activePanel.test.tsx` (2 new tests) |
| UI-006 | confirmed defect | P2 | confirmed | Settings / copy | Keep-awake status messages are inverted | `SettingsScreen.tsx:223-226` strings swapped; corrected | `issues/UI-006.md` | **Fixed & verified** — `tests/settings.test.tsx` |
| UI-011 | confirmed defect | P2 | confirmed | Collections / a11y | New-collection name input had no accessible name (placeholder only) | `CollectionsScreen.tsx:304-318` now has `aria-label="Collection name"` | `issues/UI-011.md` | **Fixed & verified** — `tests/collectionDialogA11y.test.tsx` |
| UI-012 | confirmed defect | P2 | confirmed | Notes / a11y | Edit-note textarea had no accessible name | `NotesScreen.tsx:642-649` and `ReaderScreen.tsx` note editor both now have `aria-label="Note"` | `issues/UI-012.md` | **Fixed & verified** — `tests/notesScreen.test.tsx` (reader editor covered by shared change) |
| UI-018 | confirmed defect | P2 | confirmed | Design system / rendering | Dangling CSS token references now resolve to canonical tokens; focus token defined in both themes | `components.css` stale refs mapped to `--folio-radius-*`, `--folio-surface-raised`, `--folio-accent-container`; `--folio-focus` added to `tokens.css` and byte-pinned fixture | `issues/UI-018.md` | **Fixed & verified** — new `tests/cssTokenRefs.test.ts` + `tests/tokens.test.ts` |
| SEARCH-002 | confirmed defect | P2 | confirmed (code + tests) | Search / cache | Library-search corpus now invalidates when any index is rewritten without a row change | `searchCache.ts` signature includes a generation counter; all index writers bump it; `LibraryScreen` re-runs its build effect on generation changes | `issues/SEARCH-002.md` | **Fixed & verified** — `tests/searchCache.test.ts`, `tests/import.test.ts`, `tests/pdfIndexJob.test.ts` |
| IMPORT-002 | confirmed defect | P2 | confirmed | Import atomicity | An index-write failure is no longer reported as “refused” after commit | Derived index is now written before `addDoc` in both import and Replace; a failure leaves nothing committed | `issues/IMPORT-002.md` | **Fixed & verified** — `tests/importReplace.test.ts` (new test) |
| IMPORT-003 | confirmed defect | P1 | confirmed | Import replace | Replace no longer deletes the old edition before a successful commit | Old folder is renamed to a staging folder; rollback restores it on commit failure; staging removed after success | `issues/IMPORT-003.md` | **Fixed & verified** — `tests/importReplace.test.ts` (new failing-FileStore test) |
| READ-009 | confirmed defect | P3 | confirmed | Reader / PDF preference | “Page number” toggle is a no-op control | `pageNumber` appears only in `formatPrefs.ts:61,80` and `PdfAppearancePanel.tsx:277-278`; no consumer in reader/dock | `issues/READ-009.md` | Open |
| UI-007 | confirmed defect | P3 | confirmed | Settings / destructive UX | “Delete everything” now uses the danger variant | `SettingsScreen.tsx` reset dialog button switched from `primary` to `danger` | `issues/UI-007.md` | **Fixed & verified** — `tests/settings.test.tsx` asserts classes |
| UI-013 | design inconsistency | P2 | confirmed | Shared controls / a11y | Single-select settings and filters now expose radio semantics with one tab stop | `FolioRadioGroup` used for Settings groups and Library kind/search-scope filters | `issues/UI-013.md` | **Fixed & verified** — new assertion in `tests/settings.test.tsx` |
| UI-003 | design inconsistency | P2 | confirmed | Menus / a11y | `FolioMenu` now supports Arrow/Home/End navigation and a roving tab stop | `FolioMenu.tsx` keyboard handler + `tabIndex`; modal inerting remains tracked as SHELL-004 | `issues/UI-003.md` | **Fixed & verified (keyboard semantics)** — new `tests/folioMenu.test.tsx` |
| UI-014 | confirmed defect | P2 | confirmed | Combobox a11y | `aria-activedescendant` options are no longer extra tab stops | `tabIndex={-1}` on CommandPalette and LibrarySearch `role="option"` buttons | `issues/UI-014.md` | **Fixed & verified** — new assertion in `tests/commandPalette.test.tsx` |

## Suspected risks / unverified hypotheses (do not treat as defects yet)

All entries here are in `reports/SUSPECTED-RISKS.md` with evidence and a
confirming test. Summary index:

| ID | Severity | Confidence | Area | Hypothesis |
|---|---|---|---|---|
| READ-001 | P1 | probable | Reader lifecycle | `open()` is not cancellable; destroy during open can leave orphan listeners/navigator |
| READ-002 | P1 | probable | Reader lifecycle | Stale annotation refresh can paint the previous book's highlights |
| ~~IMPORT-003~~ | P1 | **promoted / fixed** | Import replace | Was: old folder deleted before commit; now confirmed and fixed — see confirmed table and `issues/IMPORT-003.md` |
| DATA-002 | P2 | probable | Backup / settings | Synced appearance keys are documented as backed up but `user/window.json` is outside the archive |
| DATA-003 | P2 | probable | Restore / theme | Restored theme key is written to storage but never repainted or applied to the store |
| DATA-004 | P2 | probable | Backup merge | Merge restore ignores reading-log, PDF-prefs and EPUB-prefs files |
| DATA-005 | P2 | probable | Settings precedence | Global theme changes stop affecting PDFs once `pdf-prefs.json` exists |
| DATA-006 | P2 | probable | Progress flush | Fire-and-forget `writer.flush()` on non-Back exits can lose the last position |
| DATA-007 | P2 | probable | Library | Slug collision resolution computed outside the write lock |
| DATA-009 | P2 | probable | Persistence | Corrupt JSON is treated as missing and silently overwritten on the next write |
| READ-004 | P2 | probable | Reader / fullscreen | PDF focus fullscreen is not exited on unmount or manual focus exit |
| READ-005 | P2 | probable | Progress | Overlapping progress writes are not serialized; older write can win |
| READ-007 | P2 | probable | PDF search | Search hits carry no anchor, so the active match is never decorated |
| READ-011 | P2 | probable | PDF navigation | Internal PDF link jumps twice and records the destination as the Back origin |
| READ-012 | P2 | probable | PDF layout | Direction / cover-first changes invalidate layout without repainting |
| READ-015 | P2 | probable | Session info | “Total reading time” double-counts the current session |
| READ-017 | P2 | probable | EPUB footnotes | Noteref resolved against last reported locator, not the anchor's frame |
| IMPORT-004 | P2 | unverified | Onboarding import | Duplicate-resolution dialog exists only in LibraryScreen; setup import may hang |
| IMPORT-005 | P2 | unverified | EPUB import | OPF hrefs with `../` or percent-encoding are not normalized |
| NAT-002 | P2 | unverified | Tauri capability | `opener:default` may be broader than the validated Rust wrappers need |
| NAT-004 | P2 | unverified | Updater | Updater public key is still a placeholder |
| READ-003 | P2 | unverified | Reader lifecycle | Stale selection/popovers are not cleared on doc switch (normal UI currently unmounts first) |
| READ-010 | P3 | unverified | PDF preference | Persisted PDF zoom appears ignored on open (may be intentional) |
| READ-008 | P3 | probable | PDF keyboard | Implemented `scrollStep` is never called by the keyboard matrix |
| READ-013 | P3 | unverified | PDF thumbnails | Thumbnail cache not keyed by document (normal UI unmounts the strip) |
| READ-014 | P3 | probable | PDF rendering | Canvas backing-store cap not reflected in pdf.js render scale |
| READ-016 | P3 | probable | Reader popovers | Footnote / highlight popovers do not hold the chrome open |
| DATA-008 | P3 | probable | Recovery cleanup | Damaged-doc removal does not cascade user records |
| DATA-010 | P3 | probable | Settings mirror | 500 ms mirror debounce can lose a synced pref on immediate shutdown |
| DATA-011 | P3 | probable | Progress repo | Redundant double read; read-modify-write not transactionally locked |
| IMPORT-006 | P3 | confirmed (cosmetic) | Folder import copy | Skipped hidden dirs reported as unreadable; "over 500" hardcoded |
| NAT-001 | P3 | unverified | External links | Rust scheme check is case-sensitive while sanitizer is not |
| NAT-003 | P3 | confirmed (code smell) | Native surface | Unused `zip_read`/`zip_write` commands exposed with no frontend caller |
| NAT-005 | P3 | unverified | Drag/drop | All dropped paths granted, including directories |
| SHELL-001 | P2 | probable | Error handling | Boot/onboarding render tree is outside any ErrorBoundary |
| SHELL-004 | P3 | probable | Modal inerting | `.folio-toolbar` regions are not inerted under modal dialogs |
| SHELL-005 | P3 | unverified | Fullscreen | DOM fullscreen class only tracks in-app toggles, not native state |
| UI-001 | P3 | confirmed | Error boundary | Root boundary wraps Shell/Tour but not BootSplash/OnboardingFlow (same as SHELL-001) |
| UI-004 | P2 | probable | RTL layout | Shell CSS uses physical left/right offsets; `dir=rtl` does not mirror them |
| UI-005 | P3 | unverified | UI zoom | Tour/menu coordinates mix `getBoundingClientRect()` with `window.innerWidth` under CSS zoom |
| UI-008 | P3 | confirmed | Settings feedback | Single global status message is rendered below the Backup section, far from top controls |
| UI-009 | P3 | confirmed | Design tokens | `.folio-iconbtn` 40×40 vs `--folio-touch-target: 48px` |
| ~~UI-014~~ | P2 | **fixed** | Combobox a11y | Was: options were extra tab stops; now confirmed and fixed — see `issues/UI-014.md` |
| UI-015 | P3 | confirmed | Pointer targets | Colour swatch / snackbar close hit targets 16–24px vs 48px token |
| UI-016 | P3 | confirmed (documented) | i18n | Only shell chrome is localized; dialogs/screens/toasts stay English in hi/ar |
| UI-017 | P3 | latent | Shared primitive | `FolioSettingsRow` can nest interactive `control` inside a button |

## Coverage notes

- No P0 defect confirmed. Highest user harm was DATA-001 (backup/restore) and
  IMPORT-003 (replace data-loss risk); both are now fixed and verified. Remaining
  top risks: READ-001/READ-002 (lifecycle races, still suspected).
- All findings come from current source at `ed7a3a1`, not from `dist/` or the
  earlier project export. The initial architecture map was used only as a
  checklist.
- No finding was inferred solely from component size or a code smell; every
  entry has a file/symbol location and either a runtime repro or a concrete
  confirming test.
