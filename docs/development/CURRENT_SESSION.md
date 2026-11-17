# Current Session Checkpoint

**Session:** `S-20261113-01` (continued) — Production-readiness **Phase 4:
Steps 4.2–4.5 code-complete**; plan at
`~/.opencode/plan/folio-production-readiness.md`
**Updated:** 2026-11-16
**Status:** Step 4.2 complete (`33e96cc`, `df7f684`, `255bf43`); Step 4.3
CI matrix committed (`c36b2cd`, FT-040; WebDriver smoke recorded
Windows-pending per runbook `P-20261116-01`); Step 4.4 committed
(`1c22d35`, FT-041; updater wired, signing e2e Windows-pending per
runbook `P-20261116-02`). **Step 4.5 (E6 + E7) code-complete
(uncommitted)**: **E6** — fail-loudly startup dialog + `exit(1)` when the
app dir can't be created (`lib.rs` setup, `tauri_plugin_dialog`
`blocking_show`). **E7** — `ReadingSessionDialog` ticks 1/s while open
(`useReducer` + interval); `FolioDialog` close button →
`.folio-dialog__close`; `SettingsScreen` inline styles → utility classes
(`.folio-chip-row`, `.folio-stack-12`, `.folio-gap-top-12`,
`.folio-text-danger`); **synced prefs** (`lib/syncedPrefs.ts` +
`setStorageMirror` in `storage.ts`): six appearance/sort keys mirrored
debounced into the backed-up `user/window.json` (unknown keys preserved),
`restoreSyncedPrefs()` in `useBoot` fills missing keys + re-applies
zoom/contrast/locale; **manager cache**: `getLibraryManager()` singleton

- `subscribeLibraryChanges`/`notifyLibraryChanged` (fired in
  `refresh`/`refreshDocs` `finally`; Notes/Collections re-load). Tests: new
  `syncedPrefs` (6), `libraryManagerCache` (4); `axeSweep` + `notesScreen`
  mocks extended with `subscribeLibraryChanges`; `beforeEachShadow()`
  anti-pattern replaced with a real `beforeEach`. Gates: `tsc` clean,
  ESLint 0/0, prettier clean, **Vitest 689 / 689 (88 files)**, `vite build`
  green, perf 0 over budget, `cargo fmt` clean. FT-042 recorded.
  **Status addendum (2026-11-17):** the E6+E7 tranche is committed as
  `330b1de`. **Phase 4 (Steps 4.1–4.5) is complete** and the
  production-readiness plan's scope (Phases 1–4) is exhausted; `REMAINING.md`
  was refreshed with the production-readiness section and the Windows-pending
  runbooks (`P-20261116-01`, `P-20261116-02`).
  **Exact next action:** Phase 5 scoped with the user (2026-11-17): **F7
  folder import, F9 reader extras, F2 Insights** — plan drafted at
  `~/.opencode/plan/folio-phase5.md` (F3/F5/F6/F10 and F1 Markdown/CBZ
  stay out of scope; F1-PDF, F4, F8, F11 already shipped).
  **Step 5.1 (F7 folder import) code-complete (uncommitted, FT-043)**:
  Rust `pick_import_folder` (blocking_pick_folder + grant), TS
  `lib/folderImport.ts` recursive walk (extension filter, depth/file
  caps, skip-hidden), Library "Import folder…" toolbar button feeding
  the shared import queue; tests `folderImport` (7) + `libraryFolderImport`
  (2); gates green (Vitest 698 / 698, 90 files). **Next:** on
  authorization commit 5.1 (incl. the plan-reference checkpoint), then
  Step 5.2 (F9: EPUB spread mapping first).

**Session:** `S-20261114-01` — PDF support feature (Phases 0–3 + hardening),
implemented in the `pdf-support` git worktree
(`~/.local/share/opencode/worktree/8cca39/pdf-support`) off `380e6b3`;
record at `docs/development/plans/implementations/I-20261114-01-pdf-support.md`,
session log at `docs/development/sessions/S-20261114-01-pdf-support.md`.
**Updated:** 2026-11-15
**Status:** **All planned code done and merged into `main`** (merged on top of
the production-readiness line `435102a` + `ac67b64`, user-authorized). Phases
0–3 (adapter, engine, reader UI, text layer/selection/highlights/search/D2)
plus the hardening phase (plan §12): encrypted-PDF fixture + password path
(real R2/40-bit RC4 via `buildEncryptedPdf`; encrypted files refused at import
per v1.1 scope), internal PDF links (`pageLinkRects` + engine prefetch/
hit-test; GoTo → `jumpToPage`, URI → `onLink` → `openExternal` http/https-
gated), and the decoration-click popover (`DecorationPopover`: Add/Edit note,
Remove highlight). Windows-only verification (installer, release CSP,
worker/WASM proof under WebView2, `open_files.rs` cargo tests, manual smoke
incl. encrypted refusal + no-copy + anchored-surface placement) remains
pending — the Linux host has no webkit2gtk.

---

## Previous checkpoint — `S-20261113-01`

**Session:** `S-20261113-01` — Production-readiness Phases 1–3: Phase 1,
Phase 2 (Steps 2.0–2.7), and Phase 3 Steps 3.1–3.4 (async IPC + streaming
bytes; import/open decompression once, 200 MB cap, streaming imports +
per-file progress with Cancel, zip caps, additive positions cache; library
list performance — batched meta/cover reads, meta cache, import thumbnails,
sorts, windowed rows, incremental post-import patches; Rust streaming backup
export/inspect) — plan at `~/.opencode/plan/folio-production-readiness.md`
**Updated:** 2026-11-15
**Status:** Phase 1 complete; Phase 2 complete (Steps 2.0–2.7); **Phase 3
Steps 3.1, 3.2, 3.3 and 3.4 complete**. Gates: `tsc -b` clean, ESLint 0/0,
**Vitest 489 / 489 (61 files)**, `prettier --check` clean, `vite build`
green, `perf.ts` budgets pass, `cargo fmt --all -- --check` clean.
**Phase 1 + Step 2.0 committed as `203f237` and pushed to `origin/main`
(2026-11-13, user-authorized). Steps 2.1–2.2b committed as `435102a`;
Steps 2.3–2.7 and Phase 3 Steps 3.1–3.4 committed as `ac67b64`; the PDF
support feature (I-20261114-01) merged as `7f7f8c1` — all pushed to
`origin/main` 2026-11-16, user-authorized.** Post-merge integration gates
re-run on the merged tree: `tsc -b` clean, **Vitest 587 / 587 (73 files)**,
`vite build` green, ESLint 0/0, Prettier clean.
Windows runtime verification (grant flows, full Tauri `cargo test`
including the new backup unit tests, installer, webview feel of the new
list/refresh/backup surfaces, 200 MB import + cancel, cached second open,
streaming backup round-trip) remains blocked.

**Exact next action:** Step 3.5 (L4–L11 + N1–N2) — per-book ⋯ menu,
List/Grid toggle + filter chips + Continue-reading shelf + badges, inline
"New collection…" + real `<form>`s, labelled checkboxes/Shift-click/soft
delete with Undo, search listbox a11y + React-node snippets (removes both
`dangerouslySetInnerHTML` uses), "Apply to all remaining" for duplicate
imports + recovery "Remove all", notes grouping/search/export, and N2
(disable Open for missing docs).

## Phase 3 · Steps 3.3 + 3.4 — completed this pass

1. **Step 3.3a — batched reads + caches.** `mapWithConcurrency(8)` bounds
   parallel meta/cover reads; the per-doc meta cache is keyed by the
   manifest's per-doc `updatedAt` (a test pins the staleness semantics:
   entries re-read only after the manifest reports a newer touch); covers
   resolve through a stat-keyed cache plus one batched `fs_read_many` for
   misses (`cache/cover-thumb.jpg` preferred, full cover fallback).
   `LibraryFs`/Memory store gained `readMany`.
2. **Step 3.3b — import thumbnails + sorts.** `makeCoverThumbnail`
   (`src/import/cover.ts`) decodes with createImageBitmap + OffscreenCanvas
   to a ≤160 px JPEG (q 0.82) and writes it best-effort as an unregistered
   additive file after the addDoc commit point (importFile + replaceDoc).
   All row sorts now live in `sortLibraryRows` (`src/lib/libraryView.ts`,
   `{numeric: true, sensitivity: "base"}`): Recent activity (default),
   Date added, Progress, Title, Author.
3. **Step 3.3c — library screen rendering.** Covers use native
   `loading="lazy" decoding="async"` (IntersectionObserver dropped);
   rows virtualize only above 120 (`VIRTUAL_THRESHOLD`, row pitch measured
   from the first two rows with spacers); post-import patch is
   `refreshDocs(docIds)` + `lastImportedIds` highlight/scroll (6 s clear),
   a full state load happens only when rows are empty, otherwise a subtle
   `.folio-refresh-bar` (static under reduced motion) shows.
4. **Step 3.4 — Rust streaming backup (S2).** New `backup_export` /
   `backup_inspect` commands (`commands/backup.rs`, registered in
   `generate_handler`): export walks the library and streams each file
   into the destination ZIP one entry at a time — no archive-sized buffer
   in the webview — excludes the derived index/`.tmp`/OS junk/stale
   `backup.json`, writes a v2 `backup.json` (schema, manifest sha256,
   counts), and verifies the archive after the write (reopen + entry
   count + manifest checksum) before reporting success; progress via
   `folio://backup-progress` every 16 entries (`spawn_blocking` +
   `tauri::Emitter`). Inspect reads only the central directory + metadata
   (`by_index_raw`): future schemas refused, legacy v1 warned, declared
   counts/bytes reconciled against contents, manifest checksum
   recomputed. `SettingsScreen` rewired: Tauri path uses the Rust
   commands (progress listener with unlisten; restore inspects by path
   and reads bytes only at restore-confirm via new `restorePath` state),
   browser dev keeps the TS `createBackup`/`inspectBackup`; the message
   element is `role="status"`. Five Rust unit tests cover the round-trip,
   no-manifest refusal, legacy/no-checksum warnings, non-Folio +
   future-schema rejection and sandbox confinement — they run on Windows
   (the shell crate needs gtk3 to compile on Linux; `cargo fmt` clean
   here).
5. **Tests:** +8 this pass (`tests/libraryRefresh.test.ts`: 5 sort cases,
   meta-cache staleness, `refreshDocs` patch, `activityAt` keys). Suites:
   **489 / 489 (61 files)**; tsc, ESLint 0/0, Prettier, `vite build`
   green; `perf.ts` budgets within limits.

## Phase 3 · Steps 3.1 + 3.2 — completed earlier in Phase 3

1. **Step 3.1 (E1) — async IPC, raw byte bodies.** All Tauri
   fs/zip/hash commands are now `async` and hop to
   `tauri::async_runtime::spawn_blocking`, so a 200 MB read never stalls the
   IPC thread. `fs_read` returns `tauri::ipc::Response` — the frontend
   receives an `ArrayBuffer` instead of a JSON byte array. `fs_write_atomic`
   takes a single `tauri::ipc::Request`: raw `Uint8Array` body with the path
   riding the `x-folio-path` header (verified against the installed
   `@tauri-apps/api` v2 `InvokeArgs`/`InvokeOptions` docs). Temp files are
   unique per write (`{p}.{pid}-{nanos}-{counter}.tmp`, `.tmp` suffix kept)
   so concurrent writes can no longer rename each other's bytes. New
   commands: `fs_dir_size` (recursive, `symlink_metadata` — no symlink
   following) and `fs_read_many` (`Vec<Option<Vec<u8>>>`; missing → `None`,
   sandbox-guard failure → hard error) registered in `generate_handler`.
   TS call sites updated: `fileStore.ts`, `fileSource.ts` (2),
   `QuoteCard.tsx`, `SettingsScreen.tsx`. Rust unit tests keep exercising
   the sync inner bodies directly (the async wrappers only add the blocking
   pool hop); `cargo fmt` clean, shell-crate compile deferred to Windows.
2. **Step 3.2a — zip caps on the fflate side.** New
   `src/import/zipLimits.ts`: `unzipLimited()` enforces 20,000 entries /
   4 GiB total / 2 GiB per entry from the central-directory sizes fflate's
   `filter` exposes — _before_ inflating anything (a cap tripping mid-walk
   aborts without allocating the bomb). `parseEpub`, `assertImportable` and
   the sync open path use it; `LazyZip` enforces the same caps in its
   directory walk plus a per-entry cap on lazy reads. Rust `zip.rs` already
   enforced byte-verified equivalents.
3. **Step 3.2b — import limits + copy fixes.** Import cap raised to
   **200 MB** with a size-stating message ("files over 200 MB can't be
   imported"); the >50 MB detector test moved to 200 MB. Corrupt-file copy
   fixed: a zip-magic file that won't inflate (or a non-epub zip) now says
   "may be damaged" instead of wrongly blaming DRM; DRM copy is reserved
   for encryption.xml/rights.xml refusals.
4. **Step 3.2c — streaming imports + progress dialog with Cancel.**
   `PickedFile` is now `{ name, size, read() }` — bytes are read lazily,
   one file at a time, right before that file's pipeline runs, so a
   multi-file pick never holds every book in memory. Tauri picks/drops
   `fs_stat` each path up front; oversized picks are refused before any
   read. `runImportBatch` reports `importProgress` state
   (`{index, total, name}`); `LibraryScreen` renders a `FolioDialog` with a
   `role="progressbar"` bar and a Cancel button; `cancelImport()` stops the
   batch **after** the file in flight (manifest stays consistent) and the
   summary toast notes "cancelled". The per-file busy toasts are gone.
   Onboarding's `importFiles` moved to the new shape.
5. **Step 3.2d — additive positions cache.** New
   `src/store/positionsCache.ts`: per-doc `docs/<slug>/cache/positions.json`
   (`{schema: 1, contentHash, positions}` — purely additive, no schema-1
   field). `openEpubFromBytesAsync(bytes, onProgress, cache?)` loads through
   `PositionsCacheHook`; a valid cache (schema + hash match, every locator
   deserializes via `Locator.deserialize`) skips spine measurement
   entirely, otherwise the fresh list is serialized with
   `Locator.serialize()` and written fire-and-forget. Read/write failures
   degrade to the pre-cache behaviour. Wired `createReadiumEngine` →
   `useReaderEngine` (hooks built per doc from slug + manifest
   `contentHash`, so a replaced book invalidates its cache).
6. **Tests:** +2 this pass (`import.test.ts`: corrupt-copy assertion,
   `unzipLimited` round-trip; setupFlow/toastAndImport mocks moved to the
   `PickedFile` shape). Suites: **481 / 481 (60 files)**; tsc, ESLint 0/0,
   Prettier, `vite build` green; `perf.ts` budgets within limits.

## Phase 2 · Step 2.7 (R9, R6, R16, R11, R12) — completed this pass — Phase 2 complete

1. **R9 — OS theme flip repaints the open book.** `ReaderEngine` gains
   `setSystemDark(dark)`: `readiumEngine` records the flag and re-submits the
   current prefs via `applyPrefs`, so a "system" reader theme resolves to the
   other palette on the canvas (a guard skips no-change flips). The screen's
   OS-theme `matchMedia` listener now calls it alongside its own re-theme.
   Test in `tests/reader.test.ts`: submitPreferences called with the other
   backgroundColor on flip, skipped on same flag, works on flip-back.
2. **R6 — Share acts on the live selection.** `SelectionToolbar` gains
   "Share as image" (opens the QuoteCard) and "Copy with citation" buttons.
   The quote now follows the live selection: `handleEngineSelection` clears
   `quoteSelection` when the selection ends, copy actions clear it, and the
   doc-reset effect clears it too — Share can never act on stale text. New
   pure helper `src/screens/reader/citation.ts` (`citationFor`): curly-quoted
   text + em-dash + title (author optional). `tests/citationShare.test.tsx`:
   citation formatting (author present/absent) + toolbar buttons wired.
3. **R16 — one theme-aware highlight palette.** New
   `src/reader/highlightPalette.ts`: light + dark solid tints per colour name
   (`highlightCss(name, systemDark)`) plus the in-book search active-match
   colour (`searchActiveCss(systemDark)`, replacing `useInBookSearch`'s fixed
   `#FFD27F`). `decorationsFor(annotations, systemDark)` resolves through it;
   `useAnnotations` repaints existing highlights on an OS theme flip (ref-
   guarded so paint callbacks stay stable) and `useInBookSearch` repaints the
   active match. Chrome-side `--folio-swatch-*` tokens intentionally
   unchanged (chrome surfaces don't flip with the canvas reader theme; token
   fixture untouched). `tests/highlightPalette.test.ts` (4): palette mapping,
   dark ≠ light per colour, WCAG ≥4.5:1 between every tint and its theme's
   page text on all four reader themes (light #FFF3B0/#CDE8C2/#BFDFF7/
   #F8CFE0; dark #55481C/#1E4630/#1D3A52/#552A3C; active #FFD27F/#5A4010),
   and `decorationsFor` threading the flag.
4. **R11 — scrub & progress UX.** `ReaderDock`: slider scrubs in **0.1%**
   pointer steps (keyboard nudges whole points with preventDefault so it
   stays usable; commit-once semantics unchanged); chapter **ticks** over the
   track from new `ReaderEngine.chapterMarks()` (per-spine-resource start
   percents, cached, from the positions list; ReaderScreen maps them onto TOC
   titles); scrub **tooltip** "55% · Chapter 2" while dragging (also in
   aria-valuetext); **floor** percent labels (never claims 100% early);
   **Finished** label replaces the percent at 100% (time pills hidden);
   **per-chapter time** "≈ N min left in chapter" via `pace.minutesForFraction`
   between the current chapter's start mark and the next; `formatTimeLeft`
   now says "≈ 1 h 25 min left" beyond the hour. End-of-book: an auto-raised,
   dismissible `FolioDialog` card ("You've finished this book") with
   Back-to-start / Done, reset per doc load.
5. **R12 — async open, lazy resources, progress-aware splash.**
   `openEpubFromBytesAsync(bytes, onProgress)` replaces the synchronous
   `openEpubFromBytes` in the engine's open path (the sync entry point stays
   for tests and small books). Three pieces:
   - **Lazy resource decompression**: `LazyZip` walks the central directory
     once with a never-matching fflate filter to list entry names without
     inflating anything, then decompresses each entry on first access
     (`unzipSync` with a per-entry filter), cached. A `Proxy` over it exposes
     the exact eager-map shape (`get`/`has`/`ownKeys`/descriptor traps), so
     ZipFetcher's `Object.keys` and every `zipEntry` consumer are unchanged.
     Entries never touched are never inflated.
   - **Lazy/cached position generation**: `generatePositionsAsync` measures
     spine resources in 4-resource chunks, yielding to the event loop between
     chunks and reporting (done, total). Pure `positionsFromMeasured` is
     shared with the sync path, so both produce identical lists (pinned by a
     parity test).
   - **Progress-aware splash**: `ReaderEngine.open(container, onProgress)`
     reports `{ stage: "unpack" | "prepare", fraction }` — indeterminate
     while the archive is walked, 0..1 while pages are prepared.
     `useReaderEngine` holds `splashProgress` (cleared on success, error,
     failsafe, retry) and `ReaderSplash` renders a thin bar: shimmering
     "Unpacking book…" then "Preparing pages… N%" (aria-valuenow tracks).
     The 8 s splash failsafe stays as the backstop; no blob Worker is used
     because the app CSP (`script-src 'self'`) would block it.
6. **Tests:** +7 this step: reader.test.ts (async open unpack→ascending
   prepare progress, sync/async positions parity, lazy-zip map equality with
   the eager map via `Object.keys`/entry bytes/`in`), splashProgress.test.tsx
   (4: no bar before progress, indeterminate unpack, determinate percent,
   error state excludes the bar). Suites: **479 / 479 (60 files)**, tsc,
   ESLint 0/0, Prettier, `vite build` green.

## Phase 2 · Step 2.6 (R13 keyboard model) — completed this pass

1. **Letters ignore modifier combos** (`useReaderKeyboard.ts`): bare-letter
   shortcuts (`t`, `m`, `f`, `?`) require no Ctrl/Meta/Alt — Shift is
   allowed (`?` IS Shift+/, `F` covers shift typing), so Ctrl+T/Alt+M-style
   browser and app combos no longer trigger reader actions. Intentional
   combos keep working: Ctrl+F search, Ctrl+B bookmark, Ctrl+=/−/0.
2. **Modal Escape moved into the modal stack**: the keyboard ladder dropped
   its four dialog branches (shortcuts guide, session info, note editor,
   quote card) — every one is a `FolioDialog`, which already self-closes on
   Escape through `modalStack` (capture-phase, `stopPropagation`), so the
   hook's window listener never sees those presses. The ladder now owns only
   non-modal surfaces: Menu → context menu → Panel (incl. Search) →
   Distraction-free → Selection. Four hook props removed as dead code.
3. **New shortcuts**: `Ctrl+=`/`Ctrl+−`/`Ctrl+0` size the book's text
   larger/smaller/reset (browser-zoom keys reclaimed via `preventDefault`;
   per-book prefs patch through `handlePrefsChange` with a 1px step and a
   size toast), and `[` / `]` step chapter by chapter in TOC order —
   adjacent TOC entries sharing the chapter's href count as one stop,
   `goToHref` navigation via `reportNavigation`.
4. **Focus mode renamed "Distraction-free"**: More-menu label, exit pill
   (`Exit Distraction-free`, aria/title), toast ("Exited distraction-free
   mode.") and the shortcuts dialog entry.
5. **KeyboardShortcutsDialog updated**: `[`/`]` chapters, Ctrl+=/−/0 text
   size, renamed F entry — all shortcuts documented.
6. **Tests:** new `keyboardModel.test.tsx` (6): bare letters fire, modified
   letters ignored, Ctrl+F/unmodified-F split, text-size matrix (incl. bare
   `=` and Alt+`-` no-ops), `[`/`]` stepping, Escape ladder tail + menu
   branch. `shortcutsAndSession.test.tsx` renamed assertions. Suites:
   **458 / 458 (57 files)**, tsc, ESLint 0/0, Prettier, `vite build` green.

## Phase 2 · Step 2.5 (R8 single active panel) — completed this pass

1. **One panel slot** (`useReaderChrome.ts`): `ReaderPanel` widened to
   `"appearance" | "toc" | "search"` — a single state field means opening
   one panel closes the other. `openPanel`/`togglePanel` now set the TOC
   workspace tab only for `"toc"` (Appearance/Search don't touch it). The
   separate `search` chrome hold is gone: search's open state lives in the
   panel slot, so the `panel` hold pins the chrome for all three.
2. **Search state is controlled** (`useInBookSearch.ts`): the hook takes
   `open` + `onOpenChange` from the chrome instead of owning the flag —
   `toggle`/`close`/`reset` route through `onOpenChange`, so Ctrl+F, the
   toolbar button and Escape all close TOC/Appearance first. The keyboard
   hook gets `toggleSearch` (Escape's search branch folded into the panel
   branch). Verified no production loop: ReaderScreen passes stable
   `engineRef`/`navRef` refs (an inline-ref harness in the new test looped
   the debounce effect — test artifact, documented in the test).
3. **`FolioPanel` `modal` prop**: non-modal renders no scrim, no
   `aria-modal`, no focus steal or modal-stack slot; Escape closes it only
   while `modalDepth() === 0` (a dialog opened from a docked panel wins).
   TOC keeps modal behaviour; **Appearance and Search render non-modal
   docked** — appearance changes are visible unobscured on the canvas, and
   search matches can be clicked behind the panel.
4. **Tests:** new `activePanel.test.tsx` (7): chrome slot exclusivity
   (toc→search→appearance→toggle-off), controlled search open routing,
   FolioPanel modal vs non-modal rendering, non-modal Escape semantics with
   and without a modal on top. Suites: **452 / 452 (56 files)**, tsc,
   ESLint 0/0, Prettier, `vite build` all green.

## Phase 2 · Step 2.4 (R14 unify notifications) — completed this pass

1. **Toast store is a stack** (`src/shell/toasts.ts`): `toasts: Toast[]`
   replaces the single `toast` field — at most **3** visible at once, newest
   last, evicting the **oldest non-error** (never the toast being pushed;
   when everything else is an error the oldest falls off). `Toast.key?`
   gives collision-safe replacement: pushing with an identical key replaces
   the existing toast **in place** with a fresh id, so a stale auto-dismiss
   timer can never kill the replacement. `dismiss(id?)` keeps the old
   semantics (no id = dismiss all).
2. **ToastHost renders the stack** (`src/components/ToastHost.tsx`): a
   `.folio-toast-stack` container (fixed bottom-centre, column) holding up to
   three `.folio-snackbar` children, which are now **static** (positioning
   moved to the container; the keyframe lost its `translate(-50%)`). Errors
   are `role="alert"`/`aria-live="assertive"`, everything else
   `status`/`polite`. Success/info auto-dismiss after 4 s; error/busy persist.
   **Hovering the stack or focusing anything inside it pauses the timers;
   leaving resumes with a fresh 4 s window.**
3. **ReaderScreen `navNotice` removed** (state, timer ref, cleanup effect,
   standalone warn snackbar render block): `showNavNotice` keeps its name and
   signature for the hooks (`useAnnotations`, `useReaderKeyboard`,
   `useReaderChrome`) but now pushes a **keyed info toast**
   (`key: message`) — the same message fired twice shows once. ReaderScreen
   renders no snackbars of its own any more.
4. **Tests:** new `toastStack.test.tsx` (10: stacking, cap-3 eviction
   including the errors-only case, keyed replacement in place,
   `dismiss(id?)`, host rendering with per-tone roles, error vs
   auto-dismiss, hover/focus pause + resume with a fresh window, keyed
   replacement restarting the window). Existing consumers migrated to
   `.toasts`: `toastAndImport.test.tsx`, `errorLog.test.ts`,
   `tour.test.tsx`, `notesScreen.test.tsx`, `annotationActions.test.tsx`
   (Undo still verified end-to-end). Suites: **445 / 445 (55 files)**, tsc,
   ESLint 0/0, Prettier, `vite build` all green.

## Phase 2 · Step 2.3 (R5 interactive highlights) — completed this pass

1. **Decoration activation wired end-to-end** (`readiumEngine.ts` +
   `ReaderEngine.ts`): the engine registers a `DecorationObserver` on the
   navigator's "highlights" group after load (registration itself switches
   the toolkit's in-frame activation on; new frames replay the state on
   connect, verified in the navigator dist). `onHighlightActivated(cb)` hands
   the host `{id, group, x, y}` — comms coordinates are frame CSS px × DPR
   (verified in the injectables' Decorator `handleActivation`), so the engine
   divides by DPR and hit-tests `frameWindows` to resolve host-relative
   coordinates even in a two-up spread. Returning true consumes the
   activation, which also suppresses the navigator's follow-up click (no
   accidental page turn).
2. **No overlapping duplicates** (`src/screens/reader/annotationOverlap.ts`,
   pure + tested): `toggleHighlight` now classifies the selection against
   existing same-chapter highlights by quote containment — same colour
   toggles the existing annotation off, a different colour recolours it in
   place, only disjoint spans create. Bookmarks/notes never match.
3. **AnnotationPopover** (`src/components/AnnotationPopover.tsx` +
   reader.css): opened by clicking a painted highlight (annotation resolved
   from `annotationsRef`, the E2 stale-closure pattern); shows quote (+note),
   four colour swatches with the active one ringed (`aria-pressed`), and
   Add/Edit note (reuses the existing note-editor dialog flow), Copy, and
   Delete. Escape/outside-press/close dismiss; closes on the next reader
   move; the reader position never changes.
4. **Delete with Undo**: `deleteAnnotation` removes, repaints, and pushes a
   toast whose Undo action re-adds the exact record (same id and timestamps)
   then repaints. Uses the toast `action` field from 2.2a; R14 (Step 2.4)
   will give Undo a longer-lived home — the plan's "needed before R5's Undo
   ships" is satisfied by the action mechanism itself.
5. **Toolbar shows the active colour**: `SelectionToolbar` takes
   `activeColor` (the highlight the current selection overlaps); that swatch
   is ringed + `aria-pressed`, and clicking it toggles the highlight off via
   the overlap logic. `updateAnnotation` helper added for in-place updates.
6. **Tests:** 5 `annotationOverlap.test.ts` groups (chapter readout, quote
   containment, same-chapter matching, action classification), 7
   `annotationPopover.test.tsx` (render, active swatch, note-less state,
   dismissal), 6 `annotationActions.test.tsx` (hook-level: recolour/toggle/
   create, delete + Undo restore with the exact record, failed delete, update)
   against a mocked library manager. Suites: **435 / 435 (54 files)**, tsc,
   ESLint 0/0, Prettier, `vite build` all green.

## Phase 2 · Step 2.2b (noteref footnote popover) — completed this pass

1. **In-frame interception, no injectables needed** (`src/reader/footnotes.ts`
   - `readiumEngine.ts`): the navigator routes interactive clicks through its
     own comms (`pointerup` → `click` message → internal `go()`), never
     consulting host listeners for internal links. But content frames are
     same-origin (`sandbox="allow-same-origin allow-scripts"`) and Peripherals
     listens bubble-phase on the frame document, so the engine hooks each frame
     document **capture-phase** (`hookNoteref`, pruned when pool frames evict)
     and beats it: pointerup on `epub:type="noteref"` /
     `role="doc-noteref"` is stopped and turned into an activation; the
     follow-up click is suppressed (no default fragment jump), while a
     keyboard activation (click `detail === 0`) still opens the popover.
     Selection-active pointerups are left alone.
2. **Footnote extraction** (`extractFootnote`): the noteref href is resolved
   against the open chapter (`resolveNoterefTarget`, zip-absolute), the body
   is read straight from the opened zip (`EpubPackage.zip`), parsed, the
   footnote backlink removed, images dropped (their sources cannot resolve in
   a popover), and the fragment run through the existing `sanitizeHtml`
   allow-list. Blank/missing bodies report null.
3. **Host API**: `ReaderEngine.onNoteref(cb)` with `NoterefActivation`
   `{x, y, html, text, source}` (host-relative CSS px from the click, or the
   anchor's centre for keyboard activations); null = extraction failure.
   Wired through `useReaderEngine` → ReaderScreen (stale-position popover
   closes on the next locator event; failures surface as a nav notice; all
   errors logged via `handleError` context `reader.noteref`).
4. **FootnotePopover component** (`src/components/FootnotePopover.tsx` +
   reader.css): fixed card beside the reference, clamped to the viewport,
   scrollable sanitized body, header with close; dismissed by Escape
   (capture-phase), outside press, or the close button. **No navigation
   occurs** — the reader position is unchanged, no history entry.
5. **2.2a gap decision (recorded)**: navigator source confirms real internal
   links (`#frag`, relative) navigate via the navigator's own `go()` and
   never reach `handleLocator`, so 2.2a's `onInternalLink` coordinator
   routing fires only for http/https/mailto/tel and unresolvable hrefs.
   Accepted: noterefs — the dominant internal-link case — now open a popover
   instead of navigating, and other cross-references navigating
   navigator-internally (without a history entry) is a deliberate deferral;
   routing them would need `lockNavigation(true)` plus intercepting and
   replaying every anchor click through the coordinator.
6. **Tests:** 25 `tests/footnotes.test.ts` (detection incl. XHTML-namespaced
   `epub:type`, intercept ordering/dedupe/keyboard/selection guards,
   resolution, extraction/sanitization/backlink/blank/encoded paths) and 6
   `tests/footnotePopover.test.tsx` (render, close, Escape, outside press,
   inside-press stays, viewport clamping). Suites: **414 / 414 (51 files)**,
   tsc, ESLint 0/0, Prettier, `vite build` all green.

## Phase 2 · Step 2.2a (R4 back navigation core) — completed this pass

1. **Coordinator position history** (`src/reader/navigation.ts`): absolute
   moves from contents/search/annotation/link record the position the user
   left behind (read through the new `getCurrentLocation` hook);
   scrub/slider seeks and back moves record nothing; a coalesced destination
   chain records only the starting position; no-op jumps to the current spot
   record nothing; history capped at 50. `goBack()` pops the newest entry and
   never records the return; `canGoBack()` guards the affordances.
2. **Internal links route through the coordinator** (`readiumEngine.ts`
   `onInternalLink` + `handleLocator`): in-content links (footnotes,
   cross-references) no longer bypass the coordinator with a raw
   `navigator.go`; same-document `#fragment` links resolve against the
   chapter currently open; the raw navigator move remains a fallback when no
   handler is registered. Wired in `useReaderEngine.ts` alongside the other
   engine subscriptions; failures surface through `reportNavigation`.
3. **"Back to where you were" toast** (`toasts.ts` + `ToastHost.tsx`):
   additive `action?: {label, run}` on toasts rendered as a pill button that
   runs and dismisses (busy toasts show no action). After a link move lands,
   ReaderScreen offers "Back" → `nav.goBack()` ( groundwork also serves R5
   Undo / R14 action buttons).
4. **Alt+Left** in `useReaderKeyboard` (before the plain-arrow branch, so
   PageUp keeps page-turning), documented in `KeyboardShortcutsDialog` along
   with F3/Shift+F3.
5. **Tests:** 8 coordinator history cases (record/back/empty-back/scrub
   no-record/coalesce/no-op/cap), 3 keyboard cases (Alt+Left, plain arrow,
   Alt+PageUp), 2 toast-action cases. Suites: **383 / 383 (49 files)**, tsc,
   ESLint 0/0, Prettier, `vite build` all green.
6. **Deferred to Step 2.2b:** footnote popover for `epub:type="noteref"`
   instead of navigation — this Readium toolkit version has no built-in
   footnote view, so it needs frame-injection work; tracked as its own
   sub-step.

## Phase 2 · Step 2.1 (R1+R2+R3 search quality) — completed this pass

1. **Shared `htmlToText()`** (`src/lib/htmlToText.ts`): entity decode
   (`&amp;`, `&nbsp;`, `&#8217;`…), block tags → spaces, script/style/head
   skipped; single utility now used by search corpora, in-book occurrences and
   the importer; fixture `tests/fixtures/htmlToText.json` + 15 tests.
2. **Per-occurrence in-book search** (`src/search/occurrences.ts`,
   `src/reader/readiumEngine.ts`, `src/screens/reader/useInBookSearch.ts`):
   offset-preserving folded corpora cached per chapter; phrase-first then
   all-words matching; every occurrence gets a text-anchored locator
   (quote ±32 chars) that `goAnchored` resolves; caps 100/chapter, 300 total.
   `InBookSearchPanel` groups hits by chapter with per-chapter counts, "2 of
   41 matches" counter, stays open while stepping, Next/Prev buttons +
   Enter/Shift+Enter/F3 (keyboard hook), active card highlight, temporary
   active-match decoration painted via the engine and cleared on close; 2-char
   minimum; failure notice keeps the panel usable. 6 panel tests + occurrence
   unit tests.
3. **MiniSearch upgrade** (`src/search/miniSearch.ts`, `editDistance.ts`,
   `normalise.ts`): cached DFs, precomputed TFs, sorted vocabulary with
   binary-search prefix expansion, offset-based snippets (exact accent/prefix/
   fuzzy match spans via `occurrences`), quoted phrases as a hard constraint
   (`docContainsPhrase`), BM25 scoring preserved (k1=1.2, b=0.7, title boost).
   Round-trip `serialize()`/`fromPlain()` produces identical hits.
4. **Library index in a Web Worker** (`src/search/libraryIndexWorker.ts`,
   `src/search/libraryIndex.ts`): file reads stay on the main thread (Tauri
   IPC); tokenization/postings run in a Vite-bundled module worker; snapshot
   restored with `fromPlain()`; sync fallback when Worker is unavailable
   (tests/restricted webviews) or the worker errors at runtime; request ids
   match responses; "Indexing N of M documents…" progress row above the
   search bar; rows-changed guard discards stale builds. 3 builder tests +
   3 round-trip tests.

## Phase 2 · Step 2.0 (E2) — completed this pass

`ReaderScreen.tsx` split from 1,557 → ~870 lines into `src/screens/reader/`
hooks (`useReaderEngine`, `useReaderChrome`, `useAnnotations`,
`useReaderKeyboard`, `useInBookSearch` + `decorations.ts`, `keyGuards.ts`,
`resumeTargets.ts`, `launchExternal.ts`); stale `isFocusMode` closure fixed
via `isFocusModeRef`; all 16 `exhaustive-deps` warnings fixed by adding
stable deps (refs/setters, `docId` guards — never the `doc` object, whose
identity changes on every progress write); **zero `eslint-disable` remain
for exhaustive-deps**. ESLint 9 flat config + Prettier added
(`eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `pnpm lint` /
`pnpm format` / `pnpm format:check`); lint passes with **0 errors / 0
warnings**, Prettier formatted (121 files; hex pinned files excluded).
Gates: `tsc -b` clean, **Vitest 331 / 331 (45 files)**, `vite build` green,
`prettier --check` clean. **Committed as `203f237` and pushed to
`origin/main` (2026-11-13, user-authorized).** Windows runtime verification
(grant flows, full Tauri `cargo test`, installer, focus-mode/keyboard
visual parity) remains blocked.

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

1. Phase 3 Steps 3.1–3.4 are **complete**. Next: **Phase 3 · Step 3.5
   (L4–L11 + N1–N2)** per the plan
   (`~/.opencode/plan/folio-production-readiness.md` ~line 246): per-book ⋯
   menu, List/Grid toggle + filter chips + Continue-reading shelf + badges,
   inline "New collection…" + real `<form>`s, labelled checkboxes /
   Shift-click / soft delete with Undo, search listbox a11y + React-node
   snippets (remove both `dangerouslySetInnerHTML`), "Apply to all
   remaining" for duplicate imports + recovery "Remove all", notes
   grouping/search/export, disable Open for missing docs (N2).
2. Committing: Phase 1 + Step 2.0 are committed and pushed (`203f237`,
   user-authorized). Steps 2.1–2.2b are committed as `435102a`; Steps
   2.3–2.7 and Phase 3 Steps 3.1–3.4 are committed as `ac67b64`; the PDF
   feature merge is `7f7f8c1` — **all pushed to `origin/main` (2026-11-16,
   user-authorized)**. Continue committing per phase milestone with
   explicit authorization.
3. Windows-only proof still pending through Phase 3.4: real dialog/drop
   grant flows, full `cargo test --all-targets` for the Tauri crate
   (including the 5 backup unit tests), installer, keyboard matrix +
   distraction-free on a real webview, docked panels, popovers, toast
   stack, highlight tints, scrub ticks/tooltip, end-of-book card, open
   progress splash, async IPC on devices, 200 MB import + cancel, cached
   second open, virtualized list feel, streaming backup round-trip.

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
