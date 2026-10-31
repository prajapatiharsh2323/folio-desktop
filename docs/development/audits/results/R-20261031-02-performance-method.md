# R-20261031-02 — Performance budgets: harness, method, Linux baseline (FT-005)

**Date:** 2026-10-31
**Task:** FT-005 (`.docs/04` §12)
**Environment for baseline (informational):** Linux/x64, Node 24.22.1,
`Intel(R) Xeon(R) CPU @ 2.20GHz`, **jsdom DOMParser** (slower than Chromium's —
a conservative proxy, not the runtime verdict).
**Result:** harness + method **done**; code-side budgets verdicts still need a
real Windows app run. No Windows number in this record is claimed pass/fail.

## The budgets (04 §12, verbatim)

| # | Budget | Verdict needs |
|---|---|---|
| 1 | Cold open of a 3 MB EPUB: parser → first locator ≤ 1.2 s | Real webview: JS parse (+ this harness's `reader_parse` factor) + Readium `EpubNavigator.load()` + first layout paint |
| 2 | Page turn ≤ 80 ms | Real webview + input; impossible to fake in Node |
| 3 | 200 annotations painted on open ≤ 400 ms | Real webview: decoration batch application |

## Harness (committed, cross-platform)

`desktop/scripts/perf.ts`, run with:

```
cd desktop && pnpm perf
# = node --experimental-transform-types --import ./scripts/perf-register.mjs scripts/perf.ts
```

- Produces deterministic machine-readable JSON (`harness`, `environment`,
  `fixture`, per-case `samplesMs`/`medianMs`/`budget.withinBudget`). The
  fixture (`src/perf/synthEpub.ts`) generates a byte-stable EPUB ≈ 2.6–3.0 MB
  compressed with pseudo-random, def-resistant text (LCG, fixed seed), so runs
  stay comparable across hosts and days.
- Method: median of N timed runs after warmups (N documented per case).
- `--experimental-transform-types` is required because the app sources use
  TypeScript parameter properties (strip-only mode rejects them);
  `scripts/perf-loader.mjs` resolves the extensionless relative imports the
  app sources use.

### Baseline (this host, 2026-10-31 — informational, conservative)

| Case (runs) | Median | Budget context |
|---|---|---|
| `reader_parse_openEpubFromBytes` ×5 | **315.72 ms** | the "parser" factor of budget 1 — leaves ~0.9 s of the 1.2 s for webview init/first paint |
| `import_parseEpub` ×5 | **6349.82 ms** | the *"Add book"* import pipeline (per-chapter HTML parsing + sanitize) — **no stated §12 budget**; flagged as the slowest user-visible JS work found (an optimization candidate, Windows-verified before acting) |
| `import_digest_sha256` ×7 | 11.92 ms | informational |
| `locator_decode_200` ×9 | **0.27 ms** | input side of budget 3 — decode/rebuild of 200 annotation locators is negligible; paint dominates the 400 ms |

Raw JSON: `perf-20261031-linux.json` (same directory).

## Windows procedure (pending — the actual FT-005 verdict)

Defined here so the Windows pass is mechanical:

1. **Cold open (budget 1)** — in a dev or `tauri:build` run on Windows:
   `performance.now()` at: (a) user opens book → `engine.open()` entry
   (`ReaderScreen` effect), (b) first `locatorFromPosition`/first
   `locatorToString` after `EpubNavigator.load()` resolves, (c)
   `requestAnimationFrame` after the splash unmounts. Budget: `(c) - (a) ≤
   1200 ms`. Record the three sub-timings separately (parse / navigate / paint)
   so regressions localize. Output via the existing snackbar/console
   instrumentation, recorded in a follow-up `R-` entry.
2. **Page turn (budget 2)** — page-down key handler wraps
   `engine.pageTurn(dir)`; stamp `performance.now()` before the call and on
   the engine's `firstFrameOfMonth`-style callback for the new frame paint:
   measure 20 turns in both directions, report **median ≤ 80 ms** and the
   worst turn.
3. **Annotations (budget 3)** — open a test book carrying exactly 200
   bookmarks/highlights (a scripted backup restore creates this: 200
   annotations via `LibraryManager`), time the decoration batch call site
   (`engine.decorate(...)`-equivalent) until the last decoration is
   acknowledged by the engine; median over 3 opens ≤ 400 ms.
4. All three ceremonies write one JSON line each into the follow-up result
   record; do not round up and do not average runs across books.

## What stays open after this pass

- The three Windows commitments above (a real desktop session).
- Optional: reduce `import_parseEpub` cost (5–7 s on the import path is user-
  perceptible during adds; e.g. batch textFromHtml, or defer sanitize for
  covers/TOC) — Windows-verify first, then file as an improvement task if it
  persists on the Windows host (jsdom DOMParser is slower than Chromium; the
  6.3 s may shrink substantially in the real app).
