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
- ⧗ Changing app appearance + reading theme/typeface/text size then **Save and
  continue** writes the preferences; Settings → Default reading preferences
  shows the same values.
- ⧗ **Skip for now** moves on without changing global reading prefs or app
  appearance (verify the app appearance is unchanged after relaunch).
- ⧗ Setup hands off to the **five-step tour** (Library → Reader → Collections →
  Notes → Settings), and each step switches the visible route.
- ⧗ Tour closes via **Next → Start reading**, **Skip tour**, **Escape**, the
  close button, and clicking the backdrop; it does not reappear on relaunch.
- ⧗ Closing the app mid-tour and relaunching resumes at the tour, **not** at
  preference setup.
- ⧗ Settings → About → **Replay** runs the tour again; finishing returns to the
  Library.
- ⧗ Tour focus stays inside the card (Tab/Shift+Tab cycle); Escape dismisses.
- ⧗ With the tour or a dialog open, `Ctrl+1…4`, `Ctrl+,`, `F11`, and `/` do not
  act on the screen underneath.

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

*Never claim a Tauri/`cargo` build passed unless it actually ran on this
Windows host (AGENTS.md platform rule). Commit/push results back with user
authorization.*
