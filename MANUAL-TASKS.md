# Folio Desktop — Manual (Windows) Task List

**Written:** 2026-10-31, after session `S-20261031-05` + FT-012 slices 1–2
(code `4920418`, `1cf8975`, `bba37e7`).
**Why:** everything that can be implemented and verified on Linux is done
(`tsc` clean · 173 Vitest tests / 18 files · `vite build` success); the items
below **require a real Windows/webview session** and cannot be checked from
the Linux machine. See also `REMAINING.md` (historical checklist) and
`docs/development/TASKS.md` (task board). Strike items here when finished and
mirror the status in `TASKS.md`.

*(Update 2026-10-31: this list is now being worked from a Windows 11 host. The
automated half has been executed — see §0. The items still marked ⧗ are the ones
that genuinely need a person in front of the screen.)*

*(Update 2026-11-07: added §7 — manual checks for the cleanup & UX pass,
session `S-20261107-01`: first-run onboarding/tour, Settings consolidation,
Library control cleanup, search location/escaping, and resilience fixes. Linux
automation is green (`tsc -b`, 238 Vitest tests / 28 files, `vite build`); none
of §7 has been run in a real webview yet.)*

*(Update 2026-11-08: §7 labels corrected for the redesigned setup/tour, and
added §8 — manual checks for the stabilization & polish pass, session
`S-20261108-01` (imports, selection, reader close, startup/theme, onboarding,
tour spotlight, search/cover caches, collections, version, window label).
Linux automation is green: `tsc -b`, **283 Vitest tests / 39 files**,
`vite build`. All code is committed; nothing in §8 has run on Windows yet.)*

## 0. Progress — Windows 11 26100 pass, 2026-10-31 (session `S-20261031-06`)

Automated half of the list is **done and green on this host**; only the
human-at-the-screen items remain (marked ⧗ below).

- `pnpm install` — up to date (pnpm 11.9.0, Node 24.18.0)
- `tsc -b` exit 0 · **173 Vitest tests / 18 files** · `vite build` success (20.1 s)
- `cargo test --all-targets` — **23 passed / 0 failed**, exit 0
  (28 before the dictionary removal dropped the `rusqlite` cases; see
  `TASKS.md` "Verified state")
- `cargo fmt --all -- --check` — clean
- ~~`pnpm tauri:build`~~ — **success**: release compile 4 m 20 s, NSIS
  `desktop/src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe`
  (3 206 393 bytes / 3.06 MiB), exe 11.68 MB. First dictionary-free installer.
- Smoke test: build-tree `folio-desktop.exe` launched, window title `Folio`,
  31.2 MB working set, alive at 8 s, then stopped.
- CI runs **#13 `bba37e7` / #14 `8a9ca1e` / #15 `ae6bd86`** all `success` on
  `desktop-ci`.
- `%APPDATA%\Folio\dict\` — **absent** on this machine (only `library\`,
  `user\`).

Environment note: `pnpm` only resolves as `pnpm.cmd` here; the `pnpm.ps1`
shim is blocked by execution policy (and `Get-ExecutionPolicy` itself fails —
`Microsoft.PowerShell.Security` will not autoload).

## 1. P0 — Verify the pushed repair batch in the running app + rebuild installer

```powershell
cd desktop
# pnpm install           — DONE, up to date (pnpm 11.9.0)
# pnpm tauri:build       — DONE 2026-10-31: Folio_0.1.0_x64-setup.exe (3.06 MiB)
pnpm tauri:dev           # for runtime checks — ⧗ STILL PENDING
```

Runtime checks (note anything that fails; code fixes happen on Linux) — ⧗ **all
four still pending**; they need a human at the screen:

- ⧗ **FT-009** — collections round-trip: open a book from a collection → Back
  returns to the same collection; busy/error feedback on create/rename/
  delete/add/remove; missing-member handling.
- ⧗ **FT-010** — click zones in a real EPUB; TOC jumps and in-book search jumps
  land on target (the "Couldn't reach…" notice should stay silent); scrub the
  pillar, then page-turn.
- ⧗ **FT-011** — Escape ladder closes menu → panel → search → selection and
  returns focus to the More button; hovering the open More menu must not hide
  the chrome underneath; Ctrl+B toggles the bookmark live.
- ⧗ **FT-012 slices (new code)** — the Appearance → Reading width slider
  visibly re-lays out the reading column (0 = full width); right-click on the
  reading surface shows Folio's reduced menu (no native webview menu); with a
  selection it re-anchors the selection toolbar at the cursor; hovering the
  bottom 40 px keeps the pillar up ~3 s even with the cursor at rest.

## 2. P1 — `cargo test` on Windows (FT-007 backup/restore hardening)

```powershell
cd desktop\src-tauri
# cargo test --all-targets     — DONE 2026-10-31: 23 passed / 0 failed, exit 0
# cargo fmt --all -- --check   — DONE 2026-10-31: clean
```

⧗ Remaining: a real restore swap/rollback round-trip: start a restore,
interrupt it mid-way, confirm the rollback tree is put back before the library
screen renders an empty shelf.

## 3. P1 — Performance verdicts (FT-005)

Procedure in `docs/development/audits/results/R-20261031-02-performance-method.md`.
Real-hardware measurements:

- cold open of a ~3 MB EPUB ≤ 1.2 s
- page turn ≤ 80 ms
- painting 200 highlights ≤ 400 ms

## 4. P1 — Jump list visual check (FT-001)

The `PKEY_Title` heap-corruption startup crash is fixed and the app launches
(both build-tree exe and the installed `%LOCALAPPDATA%\Folio` copy). Remaining:
eyeball the pinned icon's task list shows "Open Folio" / "Import file…" and
both actions work.

## 5. P2 — polish and hardware checks

- **FT-012 visual tuning** — typography/reading-width/panels/progress feel
  right in the real webview (the deferred half of the task).
- **FT-006 runtime a11y** — screen-reader pass over reader + panels; decide
  the ≥48 px tap-target rule.
- **FT-002** — display scaling at 100 / 125 / 150 / 200% on real hardware.
- **Ctrl+Q quit-with-confirm (07 §1)** — deliberately NOT implemented yet
  (needs a confirm dialog + a Tauri exit path). Decide keep/drop; implement
  last, after 1–4.

## 6. Housekeeping

- ~~Check CI on GitHub Actions for the new commits (`4920418..8a9ca1e`) — runs
  #13+ should pass windows-latest like runs #11–12 did.~~ **DONE 2026-10-31:
  #13 (`bba37e7`), #14 (`8a9ca1e`), #15 (`ae6bd86`) all `success`.**
- ~~Old installs may leave an orphaned `%APPDATA%\Folio\dict\` directory
  (dictionary feature removed 2026-10-31) — delete manually.~~ **N/A on this
  machine — no `dict\` directory; only `library\` and `user\` exist.**

## 7. P0 — Cleanup & UX pass runtime checks (session `S-20261107-01`)

Linux automation is green: `tsc -b` clean, **238 Vitest tests / 28 files**,
`vite build` success. Nothing below has been checked in a real Windows/webview
session yet — all items are ⧗.

### 7.1 First-run setup and tour

To simulate a fresh install, back up first (Settings → Export backup), close
the app, then do **one** of:

- Delete the app's WebView profile (typically
  `%LOCALAPPDATA%\com.folio.desktop\EBWebView`) — this clears `localStorage`
  but not the library; or
- Run `pnpm tauri:dev`, open DevTools, and execute:
  ```js
  localStorage.removeItem("folio.onboarding.prefs-complete");
  localStorage.removeItem("folio.onboarding.tour-complete");
  location.reload();
  ```

- ⧗ Fresh launch opens **Set up your reading experience** (not the Library).
  **Note (S2–S4):** an existing library that still has documents now skips
  setup and tour even after the flags are cleared; for a true first-run check,
  point Folio at a clean/empty library (or temporarily move the library folder
  after taking a backup).
- ⧗ Changing app appearance + reading theme/typeface/text size then **Save and
  continue** writes the preferences; Settings → Default reading preferences
  shows the same values.
- ⧗ **Use defaults** (formerly "Skip for now") moves on without changing global
  reading prefs or app appearance (verify the app appearance is unchanged after
  relaunch).
- ⧗ Setup hands off to the **five-step tour** (Library → Reading → Collections →
  Notes → Settings); each step switches the visible route and spotlights its
  target (Library search, Import, then the sidebar destinations).
- ⧗ **Start reading** and **Skip tour** complete the tour permanently. **Escape**,
  the close button, and the backdrop dismiss it for this session only, show a
  "replay from Settings" notice, and the tour reappears on the next launch.
- ⧗ Closing the app mid-tour and relaunching resumes at the tour, **not** at
  preference setup.
- ⧗ Settings → About → **Replay** runs the tour again; finishing returns to the
  Library, while closing the replay with Escape returns to Settings.
- ⧗ Tour focus stays inside the card (Tab/Shift+Tab cycle); each step focuses
  its heading and the step counter is announced; the shell behind is inert.
- ⧗ With the tour or a dialog open, `Ctrl+1…4`, `Ctrl+,`, `F11`, and `/` do not
  act on the screen underneath; Escape closes only the topmost surface.

### 7.2 Settings

- ⧗ Only one reading-preferences entry exists; the dialog edits theme, typeface,
  and text size and does **not** duplicate the app-appearance chips.
- ⧗ App appearance is a single Light / Dark / System control; System follows the
  OS scheme without a restart, and the choice persists across relaunch.
- ⧗ Cancel in the preferences dialog discards edits; Save persists them and
  leaves other settings (width, margins, etc.) untouched.
- ⧗ Library folder → Open launches Explorer at the library; in `pnpm dev`
  (browser, no Tauri) the button is disabled and explains why.

### 7.3 Library and Notes

- ⧗ No sidebar wordmark; nav starts at the top.
- ⧗ Populated library shows **one** Import control; empty library shows the
  empty-state Import CTA; never two import buttons at once.
- ⧗ No inert Sort/More header icons and no placeholder `All` / `#tag` /
  `Collections` chips.
- ⧗ Book rows open with mouse, **Enter**, and **Space**; no `…` action button is
  shown (no action exists yet).
- ⧗ In Select mode, the row’s accessible name becomes Select/Deselect and
  clicking toggles selection instead of opening the book.
- ⧗ Notes rows open with mouse/Enter/Space; Edit and Delete do not open the
  reader; filters show their own empty copy.
- ⧗ Optional error path: temporarily rename the library folder, reopen Library /
  Notes / Collections → each shows a clear error with **Retry**; restore the
  folder and Retry recovers. (Do not run this without a backup.)

### 7.4 Search

- ⧗ A query that matches a chapter title and body shows the **book title once**
  with the chapter as secondary text (no duplicated title line).
- ⧗ Clicking a result opens the reader **at that chapter**, not at the last
  saved position.
- ⧗ A library imported **before** this build (old text index without `href`)
  still navigates to the right chapter (metadata fallback).
- ⧗ Search text containing `<`, `>`, `&`, or quotes renders literally in the
  snippet; no broken markup or missing text around the highlighted term.
- ⧗ While typing in Library search, `/`, `Ctrl+F`, `Ctrl+I`, and `Ctrl+1…4` do
  not fire; Escape closes search and clears the query.
- ⧗ In-book search remains separate: its results stay inside the reader and do
  not use the Library search panel.

### 7.5 Covers and storage

- ⧗ Import/replace a book with a custom cover, refresh the library, and confirm
  covers still render (old object URLs are released only after the new rows
  commit).
- ⧗ Block site storage (or run in a privacy mode) and confirm the app still
  starts and screens load instead of crashing on `localStorage`.

---

## 8. P0 — Stabilization & polish runtime checks (session `S-20261108-01`)

Linux automation is green: `tsc -b` clean, **283 Vitest tests / 39 files**,
`vite build` success. All five phases are committed and pushed. Run §8.0 first,
then the runtime items; every item below is ⧗ until checked in a real webview.

### 8.0 Automated half (Windows)

```powershell
cd desktop
pnpm install
pnpm exec tsc -b
pnpm exec vitest run          # expect 283 passed / 39 files
pnpm exec vite build
cd src-tauri
cargo test --all-targets
cargo fmt --all -- --check
```

- ⧗ Record the exact counts/results in `TASKS.md` (FT-018).
- ⧗ `pnpm tauri:build`, then launch the new NSIS installer build.

### 8.1 Startup, theme, and boot (S1–S4)

- ⧗ Dark theme saved: launch shows **no white flash**; the window appears once
  the first frame is ready and keeps its saved size/position.
- ⧗ Simulate a dead frontend (e.g. temporarily break the dev bundle or block
  `appWindow` in DevTools): the Rust fallback still reveals the window after
  about 1.5 s.
- ⧗ Cleared WebView storage + existing library with documents: after relaunch
  both setup and tour are skipped and the Library opens with its books.
- ⧗ Cleared WebView storage + `user/settings.json` but no documents: setup is
  skipped, the tour is offered.
- ⧗ Kill the app during the tour; relaunch resumes the tour, not setup.
- ⧗ Drag a file onto the window while setup, the tour, or a dialog is open:
  nothing imports underneath; the drop is ignored or queued until the surface
  closes.
- ⧗ Open-with / second-instance import while the tour is open: the file imports
  only after the tour closes or is dismissed.

### 8.2 Imports and messages (S5, S6)

- ⧗ Start a large import, then immediately trigger Ctrl+I, a drag-and-drop, and
  an Open-with file. Imports run one batch at a time; duplicate prompts are not
  interleaved and there is one summary at the end.
- ⧗ Import a batch with valid, duplicate, and unsupported files: the summary
  reads like "Imported 2, skipped 1, 1 failed" with a **Details** list.
- ⧗ An import failure stays on screen until dismissed; a success disappears
  after ~4 s; a message raised in Library remains visible after navigating to
  Settings/Collections.
- ⧗ Navigate away while a duplicate prompt is open: the prompt resolves as skip
  and the import queue is not left hanging (no permanent busy toast).
- ⧗ Import succeeds but the shelf refresh fails (lock the library file): the
  message says the refresh failed and still lists details.

### 8.3 Library selection and delete (G1, G2)

- ⧗ With a collection filter active, Ctrl+A selects only visible rows; the
  toolbar shows "N selected"; hidden collection members are not deleted.
- ⧗ Changing the filter or search query clears the selection.
- ⧗ Leaving Select mode clears the selection (no stale count on return).
- ⧗ Bulk delete where one document cannot be removed (lock its folder): the
  other documents still delete, the dialog closes, the shelf refreshes, and the
  failed title is listed in a persistent message.
- ⧗ Author sort places books without an author last, ties broken by title.

### 8.4 Reader Back and window close (G3, G4)

- ⧗ Normal reader Back returns to the Library and keeps the saved place.
- ⧗ Make progress persistence fail (lock `user/progress.json` or the library
  folder), then press Back: navigation still happens and a persistent
  "Last page position may not have saved" message appears.
- ⧗ From inside the reader, close the window: progress is written and the window
  closes. With persistence blocked, the window still closes within ~1.5 s.
- ⧗ Alt-tab/minimize the reader and return: progress flushes when the document
  becomes hidden.
- ⧗ Reopen the book after each case and confirm the resume location is sensible.

### 8.5 Setup and appearance (O1–O8)

- ⧗ At ~1100×560 and 720×560 the setup panel's title is reachable, the form
  scrolls, and the Save / Use defaults bar stays visible without covering text.
- ⧗ Choosing Light/Dark/System in setup changes the whole app immediately;
  **Use defaults** restores the previously saved app theme; **Save** keeps it.
- ⧗ With app appearance untouched, choosing a dark reading theme switches the
  app to dark; choosing a light reading theme switches it back. After manually
  picking an app appearance, changing the reading theme no longer changes it.
- ⧗ Reading-theme, typeface, page-flow, width-preset, and alignment groups each
  have one tab stop and respond to Arrow keys, Home, and End.
- ⧗ The typography preview renders at the chosen text size; the Publisher
  typeface sample is shown in Serif.
- ⧗ Setup focus cycles inside the dialog; "Use defaults" writes nothing
  (relaunch shows the same settings). A load failure warns instead of silently
  showing defaults, and a hung save reports the timeout.

### 8.6 Tour (T1–T6)

- ⧗ Steps spotlight Library search, Import, and the three sidebar destinations;
  the card sits beside the target and remains fully on screen at 720×560.
- ⧗ Escape, the backdrop, and the close button dismiss for this session, show
  the "replay from Settings" notice, and the tour reappears on relaunch.
- ⧗ **Skip tour** and **Start reading** complete the tour permanently; finishing
  lands in the Library.
- ⧗ Replay from Settings: completing lands in the Library, dismissing returns to
  Settings.
- ⧗ Tab never reaches the shell behind the tour; the step heading receives focus
  and the step counter is announced by Narrator.
- ⧗ With reduced motion enabled the spotlight/card transitions are disabled.

### 8.7 Modal stack

- ⧗ Open a dialog from an appearance panel or Settings, then press Escape: only
  the top surface closes and focus returns to the control that opened it.
- ⧗ Tab/Shift+Tab stay inside the topmost dialog while a panel remains open
  underneath.

### 8.8 Caches, collections, and app metadata (G5–G8)

- ⧗ Open/close Library search repeatedly on a large library: the first open may
  pause to build, later opens are immediate; importing a book then searching
  finds the new text without a restart.
- ⧗ Replace a book's cover file on disk and refresh: the new cover appears once;
  repeated refreshes do not grow memory/object URLs (DevTools memory snapshot).
- ⧗ Collections are ordered by most recently updated (name as tie-break);
  returning from a book lands directly in the collection detail without a
  gallery flash.
- ⧗ A failed collection action (e.g. read-only collections file) shows a
  persistent message and leaves the dialog open for retry/cancel.
- ⧗ Settings → About → Version matches `desktop/package.json` (`0.1.0` today).
- ⧗ Taskbar/jump-list actions still work after the window label rename
  `Library` → `main` (window restores, open-with routes correctly).
- ⧗ Install → launch → uninstall with the new installer; no console errors.

### 8.9 Evidence

- ⧗ Note pass/fail and any console output in `TASKS.md` (FT-018) and update this
  section; open a bug record for anything that fails.

---

*Never claim a Tauri/`cargo` build passed unless it actually ran on this
Windows host (AGENTS.md platform rule). Commit/push results back with user
authorization.*
