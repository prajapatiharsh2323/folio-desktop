# Remediation roadmap — prioritized after baseline audit (2026-11-28)

Ordering is by **user harm × likelihood**, not code size or component count.
Nothing in this document has been fixed. Confirmation status follows
`reports/ISSUE-REGISTER.md`; suspected items must be reproduced before they
are promoted to fixes. Every step ends with a regression test and the full
command gate from `AGENTS.md`.

## Phase 0 — Protect and establish baseline ✅ DONE
Deliverables: working-tree snapshot (`main` @ `ed7a3a1`, no tracked changes),
command inventory, `reports/BASELINE.md` (all commands actually run), synthetic
fixtures only, no destructive tests on user data.
Exit: no destructive path executed; all results recorded honestly.

## Phase 1 — Confirm the P1/P1-adjacent risks (read-only, before fixes)
| Order | Issue | Why first | Acceptance |
|---|---|---|---|
| 1 | DATA-001 | Already reproduced: edited books cannot be restored | Permanent failing test exists in `tests/libraryManager.test.ts` |
| 2 | READ-001 / READ-002 | Lifecycle races can show stale state across books | Disposable tests with delayed open/refresh demonstrate or close them |
| 3 | ~~IMPORT-003~~ | Replace can lose the original book on a mid-commit failure | **DONE & verified** — failing-FileStore test reproduced it, then staged Replace fix |
Exit: each P1 candidate has a reproduction or is explicitly marked not observed.

## Phase 2 — Stabilize core reading and data
1. ~~DATA-001 fix + permanent regression test~~ — **DONE & verified** (batch 2:
   `updateMeta` refreshes the manifest `meta.json` entry; backup restore covered).
2. READ-001/READ-002 fixes if confirmed; add cancellation tokens and
   doc-identity guards.
3. DATA-006 / READ-005 progress flush and write serialization.
4. ~~SEARCH-001 / SEARCH-002~~ — **DONE & verified** (enqueue PDF indexing at
   import/replace; content-aware cache signature via generation counter).
5. ~~IMPORT-001 / IMPORT-002~~ — **DONE & verified** (embed images in generated
   EPUB; index written before commit so `refused` cannot follow a commit).
6. ~~READ-006 (no-copy gate), READ-018 (PDF completion)~~ — **DONE & verified**
   (batch 4). READ-011/READ-012 remain open pending reproduction.
Exit: core reading, import, search and backup journeys pass the regression
matrix; EPUB and PDF capability sets still explicit.

## Phase 3 — Normalize the interaction system
- ~~UI-002 (non-modal Tab trap)~~ — **DONE & verified** (batch 1).
- ~~UI-006 / UI-011 / UI-012~~ — **DONE & verified** (batch 1: status copy,
  accessible names; includes reader note editor).
- ~~UI-003 (keyboard semantics) / UI-013 / UI-014~~ — **DONE & verified** (batch 7:
  menu arrow keys + roving tab, radio groups, combobox options non-tabbable).
  SHELL-004 inerting remains open.
- UI-004 (RTL logical properties) and SHELL-004 (modal inerting).
- Shared primitives first; avoid screen-local overrides.
Exit: keyboard-only pass on every screen, no focus escapes/overlap, dialogs
restore focus, axe sweep clean for touched screens.

## Phase 4 — Reading UX and visual consistency
- ~~UI-018 undefined tokens~~ — **DONE & verified** (batch 6: repo-wide
  reference-resolution test + canonical token mappings).
- UI-006 inverted copy (zero-risk), UI-007 danger styling, UI-008 feedback
  placement, UI-009/UI-015 pointer targets.
- READ-016 popover chrome hold, READ-010/READ-008/READ-014 if confirmed.
- Capture before/after screenshots at normal and narrow widths, light/dark and
  high contrast; keep reading canvas calm.
Exit: screenshot comparison recorded; no token drift (`tests/tokens.test.ts`).

## Phase 5 — Performance and accessibility verification
- Profile only measured hotspots; worker failure/cancellation/stale results.
- Keyboard-only, focus visibility, semantic labels, reduced motion, high
  contrast, 125/150/200% UI zoom.
- Re-run `tests/axeSweep.test.tsx` and add cases for new controls.
Exit: no regression in reading flows; measurable results documented.

## Phase 6 — Release verification
- Full gate from `desktop/`: `tsc -b` → `vitest run` → `vite build` →
  `eslint . --max-warnings 0`.
- On a **Windows host only**: `cargo fmt --check`, `cargo test --all-targets`,
  `tauri build`, NSIS install smoke and `e2e/smoke.mjs`.
- Verify clean launch, reopen, backup/restore, and upgrade paths on synthetic
  libraries.
Exit: all P0/P1 closed; P2/P3 fixed or explicitly accepted/deferred in the
issue register and session handoff.

## Smallest safe first tasks (requested by the audit prompt)
1. **UI-006** — swap two inverted status strings in `SettingsScreen.tsx:224-226`;
   add a settings copy test. Zero data/persistence risk.
2. **UI-002** — gate `trapTabKey` on `modal` in `FolioPanel.tsx:91`; add a
   focus test for both modes. Small, isolated keyboard fix.
3. **UI-011 + UI-012** — add `aria-label` to the create-collection input and the
   note textareas; add `getByRole(..., { name })` assertions. No behavior change.

DATA-001 was then fixed with its permanent test (batch 2, highest confirmed
user harm). Do not batch the lifecycle races with cosmetic fixes.
