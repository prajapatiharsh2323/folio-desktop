# S-20261030-02 — Reader locator correctness (FT-008)

**Date:** 2026-10-30
**Task:** FT-008
**Status:** complete; changes **uncommitted** and not pushed (user authorization
required for commit)

## Objective

Continue after an interrupted session. The recovery checkpoint
([`CURRENT_SESSION.md`](../CURRENT_SESSION.md), snapshot `S-20261030-01`)
described backup/restore hardening as done and FT-008 as the next unblocked P1.
One inconvenience to be clear about: FT-008 had actually been *started* (and
left half-verified) by the interrupted build session — the working tree already
contained `locatorCodec.ts` plus edits to the resume cascade, engine, reader
screen, and tests.

## What this session did

1. **Recovered state.** Read the session dump (`session.json`) of the failed
   build session to reconstruct its intent: it was interrupted right after
   editing the resume tests, before ever running them.
2. **Verified the interrupted work** with the Linux-safe checks:
   `tsc -b` clean, `vitest run` 142 tests / 13 files passing, `vite build`
   success, `cargo fmt --all -- --check` clean. The in-flight FT-008 work was
   actually sound.
3. **Reconciled scope against the task board.** FT-008 lists "resume, clickable
   zones, annotation + bookmark anchoring, relayout". The interrupted session
   had covered resume, anchoring, and bookmarks; still open were:
   - the click handler ignoring `interactive` / `defaultPrevented`
   - the `disposedRef` early-return skipping listener teardown
   - the prefs effect relaying out the navigator on every page turn.
4. **Closed those three items.**
   - `intentForReaderClick` (pure, in `chrome.ts`) returns `passthrough` for
     interactive/prevented clicks; the reader screen passes them through so
     links/footnotes keep working. Taps on two-page-turn zones are unchanged
     and still accumulate reading pace sessions.
   - The big reader effect's cleanup now always unsubscribes engine listeners
     and destroys the engine; `handleBack` only flushes + navigates. This
     removes a real leak: after back-navigating, engine callbacks survived for
     the next reader session.
   - The prefs-write effect keys on `doc?.docId`; the engine is constructed
     with the doc's prefs, so keying on the mutable `doc` object only caused
     duplicate `applyPrefs` → `submitPreferences` relayouts.
5. **Recorded the milestone** (this record, the implementation record, task
   board, checkpoint, indexes).

## Command result (final, this session)

```
./node_modules/.bin/tsc -b                 # clean
./node_modules/.bin/vitest run             # 143 tests / 13 files passing
./node_modules/.bin/vite build             # success
cd src-tauri && cargo fmt --all -- --check # clean
```

## Outcomes

- `I-20261030-02` records the implementation; `TASKS.md` FT-008 row now also
  says "Windows verification pending".
- Nothing committed or pushed — the FT-007 + FT-008 changes are still sitting
  uncommitted, pending user authorization.

## Unresolved / follow-ups

- **FT-008 Windows behaviour** (click zones, pagination, decorations) needs a
  real Tauri/webview run; Linux cannot compile the Tauri crate.
- The user chose two scoped commits: `2dce770` (FT-007) and `72d2a04`
  (FT-008). Both are local only — the push remains unauthorized by default.
- **FT-001** (taskbar jump list) is the next unblocked P1.
- Knowledge-base derived from a previous session's intermediate state: no
  additional blocker found in the resumed code, but `desktop/README.md`'s
  phase-log narrative pre-dates all of this (historical, not touched).
