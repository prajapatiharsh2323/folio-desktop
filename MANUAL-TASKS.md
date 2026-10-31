# Folio Desktop — Manual (Windows) Task List

**Written:** 2026-10-31, after session `S-20261031-05` + FT-012 slices 1–2
(code `4920418`, `1cf8975`, `bba37e7`).
**Why:** everything that can be implemented and verified on Linux is done
(`tsc` clean · 173 Vitest tests / 18 files · `vite build` success); the items
below **require a real Windows/webview session** and cannot be checked from
the Linux machine. See also `REMAINING.md` (historical checklist) and
`docs/development/TASKS.md` (task board). Strike items here when finished and
mirror the status in `TASKS.md`.

## 1. P0 — Verify the pushed repair batch in the running app + rebuild installer

```powershell
cd desktop
pnpm install
pnpm tauri:build        # first NSIS build of the dictionary-free tree
pnpm tauri:dev          # for runtime checks
```

Runtime checks (note anything that fails; code fixes happen on Linux):

- **FT-009** — collections round-trip: open a book from a collection → Back
  returns to the same collection; busy/error feedback on create/rename/
  delete/add/remove; missing-member handling.
- **FT-010** — click zones in a real EPUB; TOC jumps and in-book search jumps
  land on target (the "Couldn't reach…" notice should stay silent); scrub the
  pillar, then page-turn.
- **FT-011** — Escape ladder closes menu → panel → search → selection and
  returns focus to the More button; hovering the open More menu must not hide
  the chrome underneath; Ctrl+B toggles the bookmark live.
- **FT-012 slices (new code)** — the Appearance → Reading width slider
  visibly re-lays out the reading column (0 = full width); right-click on the
  reading surface shows Folio's reduced menu (no native webview menu); with a
  selection it re-anchors the selection toolbar at the cursor; hovering the
  bottom 40 px keeps the pillar up ~3 s even with the cursor at rest.

## 2. P1 — `cargo test` on Windows (FT-007 backup/restore hardening)

```powershell
cd desktop\src-tauri
cargo test --all-targets     # Linux only ran --target x86_64-pc-windows-gnu checks
cargo fmt --all -- --check
```

Plus a real restore swap/rollback round-trip: start a restore, interrupt it
mid-way, confirm the rollback tree is put back before the library screen
renders an empty shelf.

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

- Check CI on GitHub Actions for the new commits (`4920418..8a9ca1e`) — runs
  #13+ should pass windows-latest like runs #11–12 did.
- Old installs may leave an orphaned `%APPDATA%\Folio\dict\` directory
  (dictionary feature removed 2026-10-31) — delete manually.

---

*Never claim a Tauri/`cargo` build passed unless it actually ran on this
Windows host (AGENTS.md platform rule). Commit/push results back with user
authorization.*
