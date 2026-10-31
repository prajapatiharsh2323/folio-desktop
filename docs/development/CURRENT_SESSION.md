# Current Session Checkpoint

**Session:** `S-20261031-02` — perf budget harness (FT-005)
**Updated:** 2026-10-31
**Status:** FT-005 harness + method + Linux baseline **implemented and
pushed**; all code-side tasks (FT-001…FT-008) now have their Linux-side work
done and recorded. Every remaining item needs a Windows desktop session, a
Google OAuth client ID, or the dictionary pack asset.
`session.json` (previous transcript dump) remains the only untracked file.

## Verified current state

- Branch `main` in sync with `origin/main`.
- Linux verification (2026-10-31), from `desktop/`:
  - `./node_modules/.bin/tsc -b` — clean (now includes `scripts/`)
  - `./node_modules/.bin/vitest run` — **149 tests / 15 files** passing
  - `./node_modules/.bin/vite build` — success
  - `cd src-tauri && cargo fmt --all -- --check` — clean
  - `node --experimental-transform-types --import ./scripts/perf-register.mjs
    scripts/perf.ts` (`pnpm perf`) — runs end-to-end with machine-readable
    JSON output, see
    [`R-20261031-02`](audits/results/R-20261031-02-performance-method.md)
- CI `desktop-ci` green for the FT-006 push (Rust 31/0 + frontend).
- Not run here: `cargo test` locally (webkit; CI covers it), any Windows
  desktop behaviour.

## Completed in this session (FT-005)

1. Deterministic perf harness (`scripts/perf.ts` + `src/perf/synthEpub.ts`,
   PRNG-based ~3 MB compressed synthetic EPUB) with median-of-N samples and
   per-budget scope tags; `pnpm perf` wired into `package.json`.
2. Linux baseline (jsdom, conservative): reader-side parse of the 3 MB EPUB
   **315.7 ms median** (leaves ~0.9 s of budget 1 for webview + paint);
   import-path parse **6.3 s median** flagged as an optimization candidate
   (jsdom DOMParser is slower than Chromium — verify on Windows first);
   200-locator decode **0.27 ms**.
3. Windows runtime measurement procedure (cold-open 3-timestamp split,
   20-turn page-turn sweep, 200-annotation decoration batch) recorded in
   [`R-20261031-02`](audits/results/R-20261031-02-performance-method.md).

## Open work (all blocked on non-code resources)

- Windows session: budget verdicts (FT-005), jump-list runtime checks
  (FT-001), reader/focus/screen-reader verifications (FT-006/008), restore
  swap (FT-007), scaling (FT-002).
- Credentials: FT-003 Drive sync E2E (Google OAuth Desktop client ID).
- Asset: FT-004 dictionary pack (`mobile/tools/build_dict.py` — the mobile
  tree is absent from this repo).

## Exact next action

No further code-side work is actionable on this host. The next useful step is
a Windows run following the procedures in `R-20261031-02` and
`A-20261031-01`, or the remaining external-resource tasks.
