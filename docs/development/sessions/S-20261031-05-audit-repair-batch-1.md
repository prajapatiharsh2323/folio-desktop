# S-20261031-05 — Audit repair batch 1: collections routing, navigation controller, menus, dictionary removal

**Date:** 2026-10-31 (Linux session)
**Origin:** external application audit (uploaded exports) plus in-repo
verification of every finding before implementation — all confirmed.
**Record:** [`I-20261031-05-audit-repair-batch-1.md`](plans/implementations/I-20261031-05-audit-repair-batch-1.md)

## What was done

1. **Collections (FT-009):** `routeStore` gained `ReaderOrigin`
   (`route`, `collectionId`); `closeReader` returns to the originating screen
   and the Collections screen restores its selected collection. Member titles
   are real open buttons (missing docs → disabled + "· missing"); separate
   remove action (no nested buttons). All mutations pass one `runOp` gate with
   a warn snackbar for failures.
2. **Navigation (FT-010):** `reader/navigation.ts`
   `ReaderNavigationCoordinator` — every user navigation (clicks, keyboard,
   scrub/Home-End, TOC, search) funnels through it: refcounted seek gate,
   superseded-request suppression, boolean outcomes. Failures surface as
   notices; `goToHref` no longer swallows `engine.go()`'s result. TOC
   selection now closes the panel like search results.
3. **Menus/controls (FT-011):** More menu is controlled state; auto-hide does
   not run under an open menu; Escape closes menu → panel → search →
   selection and restores focus to the More button; keyboard shortcuts no
   longer fire on focused buttons/menu items; the "Add bookmark — Phase 5"
   placeholder is replaced by a live bookmark toggle (menu + Ctrl+B share the
   same handler with outcome notices). TOC highlight comparison tolerates
   fragments/encoding.
4. **Dictionary removal (FT-004 retired → D-20261031-05):** meaning card,
   dict bridge, `dict.rs` + commands, `rusqlite`, `dict/*` resources,
   Settings About rows and `.folio-meaning` CSS all removed. Source-scan
   regression guard added (`tests/noDictionary.test.ts`).
5. **Search race (audit Phase-4 item):** debounced in-book search now carries
   a request token; stale results cannot replace newer ones.

## Verified (Linux)

`tsc -b` clean; Vitest **164/164** (17 files; +24 new: origin ×5, navigation
coordinator ×9, chrome menu/TOC ×8, dict guard ×2); `vite build` OK;
`cargo check --all-targets --target x86_64-pc-windows-gnu` OK;
`cargo fmt --check` OK; `Cargo.lock` regenerated without `rusqlite`.

Environment note: `/home` (4.8 GB) filled during a Rust rebuild — the long
Windows-target check needs `CARGO_TARGET_DIR=/tmp/opencode/folio-cargo-target`
and `mingw-w64` had to be apt-installed before the cross-target check ran.

## Open work

- Windows session: verify FT-009/010/011 in the running app (collections
  round-trip, click zones, menu timing), FT-002 scaling, FT-005/FT-006/FT-008
  runtime items; rebuild the NSIS installer.
- Audit Phase 4 (typography/visual UX) remains open (FT-012) — Windows-dependent.
