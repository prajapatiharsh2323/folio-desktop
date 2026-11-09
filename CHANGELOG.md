# Changelog

User-visible and data-safety changes for Folio Desktop. Local commits only;
nothing here has been pushed unless a later note says so.

## 0.1.0 — 2026-11-09 — First release

### First-run setup and tour

- Setup is now two full-bleed screens driven by one linear machine:
  `look → library → done`. The step label comes from the machine, step 1 always
  clears the step-2 flag, and boot rules are explicit (no preferences → setup;
  preferences without step 2 → setup at step 2; existing documents or both
  flags → straight to the Library).
- The old two-column setup (eyebrow, lede, bullets, footer note, separate app
  appearance group, five-theme grid, pixel slider, sticky action bar) is gone.
  The look screen previews type and size; the library screen collects reading
  preferences and imports in place.
- Step 1 **Skip** saves only the completion flag, so quitting before step 2
  resumes at the library screen instead of repeating step 1.
- The tour no longer auto-opens after setup. It is opt-in via Settings → About
  → **Replay tour**; dismissing it no longer marks it complete or blocks
  first-run. Setup fits a 720×560 window without a scrollbar and transitions
  with a 200 ms cross-fade plus an 8 px slide.
- Development builds expose `window.__folioResetOnboarding()` to replay setup
  without clearing the library.

### Review hardening (no High-severity findings)

- Notes edits/deletes have a busy guard, report failures through the toast host
  and keep the draft/dialog open for retry.
- A failed search-index build is retried instead of being cached for the life
  of the book.
- Non-Unicode launch arguments no longer panic startup; such paths are skipped.
- Percent-encoded EPUB container paths reach the decoded OPF.
- Restore counts actual expanded bytes, closing a total-budget bypass.
- Deferred Low items are listed in [`FINDINGS.md`](FINDINGS.md).

### Privacy, diagnostics and release engineering

- HTML articles keep only inline `data:` images; remote, protocol-relative and
  relative images are dropped before import. `img-src` no longer allows
  `https:` in the release or dev CSP.
- Unhandled errors are appended to `%APPDATA%\Folio\user\logs\folio.log` by
  Rust (512 KB rotation, one previous file). Settings shows the real path and
  can open the folder. Nothing is uploaded and the app still makes no network
  requests.
- `pnpm bump-version` updates package.json, `tauri.conf.json`, `Cargo.toml`,
  `Cargo.lock` and the backup `APP_VERSION` together; a test fails on drift.
- Restored windows are promoted to the 720×560 minimum while still fitting
  monitors with a smaller work area.
- Added a root README and the Windows installer/release checklist in
  `docs/development/RELEASE.md`.
- `pnpm perf` runs under Node's native TypeScript loading (Node 22.18+/26).

### Verification

- Linux: `tsc -b` clean, **315 Vitest tests / 43 files** passing, `vite build`
  successful (existing chunk-size warning only), `pnpm perf` within its
  measurable budgets.
- Rust/Tauri build, installer, Narrator and display-scaling checks require a
  Windows host and remain tracked in `MANUAL-TASKS.md` / `RELEASE.md`.

## 2026-11-08 — Stabilization & polish pass

### Phase 5 — Remaining audit items and cleanup (G5–G8)

- Library search builds its index once per corpus instead of re-reading every
  text index each time the search panel opens; it rebuilds after imports,
  deletes, or retitles and re-runs a query typed while it was building.
- Custom cover URLs are cached per document and invalidated by the cover
  file's size and mtime, so refreshes no longer decode every cover again; a
  failed refresh still releases only the URLs it created.
- Collections are sorted most-recently-updated first with a name tie-break;
  returning from the reader no longer flashes the gallery while the restored
  collection loads, and collection operation errors use the global host.
- The About row reads the real version from `package.json` through Vite
  instead of a hard-coded string.
- Reading pace is created before the navigation coordinator that closes over
  it, removing a temporal-dead-zone hazard.
- The Tauri window label is now `main` (config, capabilities, and Rust
  lookups), replacing the old `Library` label.

### Phase 4 — Tour redesign

- Escape, the backdrop, and the close button now dismiss the tour for this
  session only and post a replay hint; only "Skip tour"/"Start reading" mark
  it complete.
- Steps spotlight the control they describe (search, import, and the sidebar
  destinations) and place the card beside it; steps without a target stay
  centred.
- The shell is inert and hidden from assistive technology while the tour is
  open, each step moves focus to its heading, and the counter is announced.
- Finishing lands in the Library; dismissing returns to the route where the
  tour opened.
- Modal surfaces now share a stack, so Escape closes only the topmost dialog,
  panel, or tour instead of every open surface at once.

### Phase 3 — Onboarding and appearance polish (O1–O8)

- Setup fits a short window: the panel is centred when it fits, its top stays
  reachable when it does not, and the Save/Use defaults bar stays visible.
- App appearance previews live while setup is open and reverts if the user
  leaves without saving; choosing a reading theme links the app theme until
  the user picks one explicitly.
- Copy now says "Use defaults" and explains that it writes nothing; saving has
  a 10 s cap and a load failure is reported instead of silently showing
  built-in values.
- Every selection group (reading theme, typeface, page flow, width presets,
  alignment, alignment switches) is a real radio group with one tab stop and
  Arrow/Home/End navigation; the preview renders at the chosen text size and
  the "Publisher" typeface is shown in Serif.
- Setup is focus-trapped, shows a "Step 1 of 2" label, and its theme grid
  reflows instead of squeezing five swatches into a narrow column.

### Phase 2 — Library and reader safety (G1–G4, S1)

- The window starts hidden, applies the saved theme before the first paint,
  and is revealed after the first frame (Rust fallback after 1.5 s), so a dark
  launch no longer flashes white.
- Multi-select deletes can no longer hide failures: each document is deleted
  independently, the dialog always closes, the shelf always refreshes, and
  failed titles are listed in a persistent message.
- Reader Back always returns to the Library, even when saving progress or
  releasing the sleep lock fails; a failed save is reported.
- The Tauri close request waits (up to 1.5 s) for progress to flush, and
  progress also flushes when the document becomes hidden.

### Phase 1 — Import and selection safety (S5, S6, G1, G2)

- Imports run through one process-wide queue, so overlapping open-with,
  Ctrl+I and drag-and-drop batches cannot interleave manifest writes or
  duplicate prompts.
- Per-file failures are caught, the shelf is refreshed in every case, and
  multi-file imports report one summary with a details list.
- Messages moved to a global host: errors persist until dismissed, successes
  clear after 4 s, and notices survive a route change.
- Ctrl+A selects only books visible under the active collection filter, the
  selection clears when the filter or search changes, and the toolbar shows
  the selected count.
- Author sort places authorless books last, with a title tie-break.

### Verification

- Linux: `tsc -b` clean, Vitest 283/283 passing (39 files), `vite build`
  successful (existing chunk-size warning only).
- Rust/Tauri compile and Windows runtime checks were not run on this host.
