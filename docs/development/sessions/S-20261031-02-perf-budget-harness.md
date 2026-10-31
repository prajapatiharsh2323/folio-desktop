# S-20261031-02 — Performance budget harness + method (FT-005)

**Date:** 2026-10-31
**Task:** FT-005
**Status:** harness + method + Linux baseline **committed and pushed**; the
runtime budget verdicts require a real Windows session (procedure defined)

## Objective

Continue after the FT-006 accessibility pass. FT-005 was the last code-side
task with no harness ("Define measurement method, then record results under
audits/results/").

## What this session did

1. **Scoped the measurements honestly.** Budget 1 (cold open ≤ 1.2 s) has a
   *parser* factor that is pure JS and runnable cross-platform; webview
   init/paint and the page-turn input path can only be measured in the real
   app. The harness measures the former and names the latter.
2. **Built a deterministic harness**: `desktop/scripts/perf.ts` +
   `src/perf/synthEpub.ts`. The synthetic EPUB is byte-stable for a given
   (target, chapter count), pseudo-random so deflate can't shrink it away (a
   first draft shrank 3 MB of text to 49 KB — exactly the failure mode the
   PRNG version avoids), sized against the *compressed* 3 MB reference.
3. **Wired it into Node's TS transpile** (extensionless relative imports +
   parameter properties): `scripts/perf-loader.mjs` (+ `perf-register.mjs`),
   `--experimental-transform-types`, `pnpm perf` script added.
4. **Baseline (Linux, jsdom, conservative)**: reader-side parse of the 3 MB
   fixture **316 ms median** (the budget-1 parser factor leaves ~0.9 s for
   webview+paint); import-path parse (different flow, no §12 budget)
   **6.3 s median** — flagged as an optimization candidate, to be verified on
   Windows first since jsdom's DOMParser is slower than Chromium's;
   sha256 12 ms; 200-locator decode **0.27 ms** (paint dominates budget 3).
5. **Defined the Windows runtime measurements** (cold-open 3-timestamp split,
   20-turn page-turn sweep, 200-annotation decoration batch over a scripted
   backup) in [`R-20261031-02`](../audits/results/R-20261031-02-performance-method.md)
   so the Windows pass is mechanical.

## Results

Raw: [`perf-20261031-linux.json`](../audits/results/perf-20261031-linux.json).
Full readout: [`R-20261031-02`](../audits/results/R-20261031-02-performance-method.md).

## Verification (this session)

- `tsc -b` clean (incl. the new `scripts/` dir; `allowImportingTsExtensions`
  enabled for the loader-friendly imports in perf.ts).
- 149 tests / 15 files remain green (harness is not in the vitest run).
- `vite build`, `cargo fmt --all -- --check` green.

## Unresolved

- The three Windows verdicts (budget 1/2/3) and the import-path slowdown
  check, per `R-20261031-02`.

## Exact next action

Nothing code-side remains that this host can execute: FT-001..FT-008 have
their Linux-side pieces done and recorded. Everything else is a Windows
session (runtime verifications) or external credentials/assets (FT-003
Google client, FT-004 dictionary pack).
