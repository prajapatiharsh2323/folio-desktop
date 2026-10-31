# I-20261031-05 — Application audit repair: collections routing, navigation controller, menu/controls, dictionary removal

**Status:** done (Linux verified; Windows unverified)
**Origin:** 2026-10-31 external application audit + in-repo verification of
every finding against the source (all confirmed; paths corrected to
`desktop/src/…`).
**Task board:** see rows FT-009/FT-010/FT-011 in [`../../TASKS.md`](../../TASKS.md).

## Scope

Four repair phases from the audit roadmap, implemented in order:

1. **Collections repair (FT-009, P0)**
   - `store/routeStore.ts`: added `ReaderOrigin { route, collectionId }` +
     `readerOrigin` state. `openReader(request, origin?)` captures the
     originating screen; `closeReader()` returns there instead of always to
     Library. `readerOrigin` survives close until the next `openReader` or
     sidebar `setRoute` (CollectionsScreen consumes it once on mount).
   - `screens/CollectionsScreen.tsx`: the member title is now a real button
     wired to `openReader({ docId }, { route: "collections", collectionId })`;
     remove action stays a separate sibling (no nested buttons; the row itself
     lost the dead `folio-row--clickable` class). Missing manifest docs render
     disabled with a "· missing" mark. All create/rename/delete/add/remove
     actions go through one `runOp` gate: concurrent submissions blocked,
     dialogs stay open on failure, errors surface on a `.folio-snackbar--warn`.
   - `styles/components.css`: `.folio-collection-member__open/__missing`,
     `.folio-snackbar--warn` (existing `--folio-danger`/`--folio-on-accent`
     pairing, same as `.folio-btn--solid-danger`).
2. **Navigation controller (FT-010, P0)** — thin coordinator, not a
   full-form controller: `reader/navigation.ts`
   (`ReaderNavigationCoordinator`, `createNavigationCoordinator`). Every
   user-initiated navigation funnels through it: click zones, keyboard,
   scrubbing/Home-End, TOC, in-book search. The engine still talks to Readium
   unchanged (FT-008 constraint: no navigator recreation). The coordinator
   owns the three missing things: the seek gate (refcounted, so overlapping
   jumps cannot un-gate the ProgressWriter early), outcome sequencing
   (superseded requests cannot report stale failures), and a boolean contract
   every call site now handles — failures surface as `.folio-snackbar--warn`
   notices ("Couldn't reach that section/result/position").
3. **Menu + control repair (FT-011, P0)**
   - `ReaderChrome.tsx`: More menu is controlled state passed in from
     `ReaderScreen` (was component-local and unknown to keyboard/auto-hide);
     removed the disabled "Add bookmark — Phase 5" placeholder; the menu's
     bookmark item does the live toggle.
   - `ReaderScreen.tsx`: Escape closes menu → panel → search → selection and
     returns focus to the More button (`#folio-reader-more`). The auto-hide
     tick does not run while the menu is open (menu hover keeps chrome alive).
     `isTypingTarget` now also excludes buttons, links and menu items, so
     keyboard page-turns cannot fight a focused control.
   - `handleBookmarkToggle` returns `added|removed|failed`; Ctrl+B and the
     menu item both announce the outcome as a notice; write failures no
     longer look like success.
   - `TocPanel.tsx`: `tocHrefMatches` (exported, unit-tested) tolerates
     fragments and percent-encoding deltas — active chapter highlighting no
     longer depends on raw string equality.
4. **Dictionary removal** — see [`D-20261031-05`](../../decisions/D-20261031-05-dictionary-removal.md).

Audit Phase-4 items intentionally **deferred**: reading-width/typography and
visual tuning (needs a Windows webview session — unverified CSS is how
regressions ship here). The search race (audit Phase 4) was fixed because it
is behavioural, not visual: debounced in-book search now carries a request
token and stale results are discarded.

## Files touched

`store/routeStore.ts`, `screens/CollectionsScreen.tsx`, `screens/ReaderScreen.tsx`,
`screens/SettingsScreen.tsx`, `components/ReaderChrome.tsx`, `components/SelectionToolbar.tsx`,
`components/TocPanel.tsx`, `reader/navigation.ts` (new), `styles/components.css`,
`src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/Cargo.toml`,
`src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`; deleted dict files (see
the decision record).

## Verification (Linux, 2026-10-31)

- `tsc -b` clean (strict).
- Vitest **164 tests / 17 files** passing — +24 over the 140 baseline:
  5 origin-tracking (`shell.test.tsx`), 9 navigation coordinator
  (`navigation.test.ts`), 8 controlled menu + TOC matching
  (`readerChrome.test.tsx`), 2 dictionary-removal guards
  (`noDictionary.test.ts`).
- `vite build` success (pre-existing chunk-size warning only).
- `cargo check --all-targets --target x86_64-pc-windows-gnu` exit 0 after the
  dictionary removal; `cargo fmt --all -- --check` clean; `Cargo.lock`
  regenerated (`rusqlite` gone).

## Not verified here (needs a Windows session)

Real webview behaviours: click zones, TOC/search navigation in real EPUBs,
menu/auto-hide timing, collections round-trip in the running app, and the
NSIS build.

## Follow-ups

- Windows verification pass for FT-009/FT-010/FT-011.
- Audit Phase 4 (reader UX: typography, reading width, panels) stays open,
  Windows-session dependent.
- Committed locally on 2026-10-31 (four topic commits); push awaits
  explicit user authorization.
