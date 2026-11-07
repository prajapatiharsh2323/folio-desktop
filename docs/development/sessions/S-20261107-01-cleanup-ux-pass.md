# S-20261107-01 — Cleanup and UX pass (onboarding, Settings, Library, search, resilience)

**Date:** 2026-11-07
**Status:** Complete (code) / blocked (Windows verification). Uncommitted.
**Scope:** First-run onboarding + tour, Settings consolidation, Library control
cleanup, search correctness, accessibility/resilience fixes. No schema-1 data
model, library layout, import pipeline, reader engine, or backup format changes.

## Objective

Implement the "Folio Desktop — cleanup and UX pass" report: give fresh installs
a preference setup and a short tour, remove dead Library controls, make search
results navigate to the right chapter without duplicate titles or unescaped
markup, and harden the UI against storage/cover-URL/overlay edge cases.

## What was inspected

- `App.tsx`, `Shell.tsx`, `Sidebar.tsx`, `theme.ts` — startup, routes, shortcuts.
- `LibraryScreen.tsx`, `NotesScreen.tsx`, `CollectionsScreen.tsx`,
  `SettingsScreen.tsx` — dead controls, error/empty states, row semantics.
- `FolioBookRow.tsx`, `FolioDialog.tsx`, `focusTrap.ts` — interaction nesting.
- `miniSearch.ts`, `readiumEngine.ts`, `importService.ts`, `reindex.ts`,
  `locatorCodec.ts`, `routeStore.ts` — search indexing and navigation.
- `libraryUi.ts` — refresh errors and cover object-URL lifecycle.
- `model/types.ts` — confirmed untouched (schema-1 frozen).

## Changes

### Onboarding and tour
- `lib/storage.ts`: safe Web Storage wrapper; blocked/absent storage degrades to
  in-memory defaults instead of throwing.
- `theme/theme.ts`: StrictMode-safe `initTheme()` with listener identity cleanup;
  all theme storage goes through the safe wrapper.
- `onboarding/onboardingState.ts`: separate persisted flags for preference setup
  (`folio.onboarding.prefs-complete`) and tour (`folio.onboarding.tour-complete`),
  so closing mid-tour resumes the tour rather than restarting setup.
- `onboarding/PreferencesEditor.tsx`: shared editor for app appearance (optional),
  reading theme, typeface, text size. Used by both first-run and Settings.
- `onboarding/OnboardingFlow.tsx`: welcome copy + editor; saves only the fields
  the editor owns into global `ReadingPrefs`, preserving unknown keys; app
  appearance is a draft until Save. "Skip for now" writes no preference.
- `onboarding/Tour.tsx`: five steps (Library, Reader, Collections, Notes,
  Settings), route shortcuts, focus trap, Escape/backdrop/skip dismissal, and
  "Replay" from Settings.
- `App.tsx`: gates the shell behind setup, overlays the tour over the shell.

### Settings
- One "Default reading preferences" row opens the shared editor in a dialog
  (theme/typeface/size); app appearance stays a single control in Settings.
- Welcome-tour replay row.
- Library folder button disabled outside Tauri; open failures surface a message.

### Library
- Removed sidebar wordmark/brand markup and CSS.
- Removed inert Sort/More toolbar icons, placeholder filter chips, and the
  duplicate icon-only Import; exactly one visible import entry (empty-state CTA
  when empty, toolbar Import when populated).
- Library controls collapse into one toolbar shown only when rows exist.
- Book rows are real buttons with sibling action controls (no nested buttons);
  the optional "…" action renders only when a handler is supplied.
- Load errors: retry banner when rows exist, full empty-state retry when not;
  collection-filtered empty copy with "Show all books".

### Search
- Snippets escape book text before adding `<mark>`; only the highlight markup is
  HTML.
- Library results show the document title once and the chapter as secondary
  text; hits carry `docTitle` and `href`.
- Chapter `href` is persisted in `index/text/*.json` on import and reindex;
  older indexes fall back to `meta.json` chapter hrefs.
- Opening a result passes the chapter `href` (+fragment) to the reader.

### Accessibility and resilience
- Notes rows use a real button plus sibling edit/delete controls; per-filter
  empty copy and load-error retry.
- Collections load errors get a retry state.
- Global shortcuts are gated while a modal/panel/onboarding/tour overlay is open
  or while typing in an editable control (`shell/overlays.ts`).
- Cover object URLs from a previous refresh are revoked after React commits the
  new rows; a failed refresh revokes its own partial batch.
- Filter-aware Library/Notes empty states.

## Verification (Linux, this environment)

- `./node_modules/.bin/tsc -b` — clean.
- `./node_modules/.bin/vitest run` — **238 passed / 28 files** (16 new tests:
  onboarding state, snippet escaping, locator navigation, book-row semantics).
- `./node_modules/.bin/vite build` — success (existing chunk-size warning only).
- `pnpm`/`corepack` unavailable; `desktop/node_modules` was installed with
  `npm install --no-package-lock --ignore-scripts`.
- Rust/Tauri build and runtime checks were **not** run (Linux host lacks
  `webkit2gtk`/`gtk3`).

## Decisions

- Onboarding completion flags live in `localStorage`, not the library schema, so
  user data layout stays untouched.
- The tour is a centered focus-trapped card that switches routes, not spotlight
  coach marks.
- Settings and onboarding share one editor component; app appearance is shown
  only during onboarding because Settings owns that control.
- Only editor-owned preference fields are written; other schema-1 keys survive.

## Unresolved / next action

1. Windows verification: `cd desktop && pnpm install && pnpm exec tsc -b &&
   pnpm exec vitest run && pnpm exec vite build`, then
   `cd src-tauri && cargo test --all-targets`.
2. Runtime smoke: first-run setup → tour → Settings replay; search result opens
   at the chapter; library/notes/collections error retries; overlay shortcut
   gating; cover URLs after re-import.
3. Changes are uncommitted; no commit/push authorization has been given.
