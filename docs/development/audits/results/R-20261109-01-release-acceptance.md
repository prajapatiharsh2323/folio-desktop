# R-20261109-01 — 0.1.0 Release Acceptance

**Date:** 2026-11-09 · **Session:** `S-20261109-01`
**Verdict:** code-complete and Linux-verified; **not releasable until the
Windows installer/runtime checklist in `docs/development/RELEASE.md` passes.**
This host has no Windows webview, no Rust toolchain and no installer tooling,
so clean-profile, installer, Narrator and display-scaling acceptance could not
be executed here.

## Changes by Part

| Part | Commit | Summary |
|---|---|---|
| A — setup machine | `8325219` | One linear `look → library → done` machine, machine-derived step label, step 1 clears step 2, explicit boot rules, dev-only reset helper. |
| B — two-screen setup | `b8940f0` | Full-bleed look/library screens; removed eyebrow/lede/bullets/footer, app-appearance group, five-theme grid, mono/publisher picker, pixel slider, two-column and sticky bar. Tour opt-in only. 200 ms cross-fade + 8 px slide; no scrollbar at 720×560; accessible groups/focus. |
| C — review | `cfd496a` | No High findings. Fixed five Medium issues (notes write safety, cached search rejection, non-Unicode argv, encoded OPF path, restore total budget). Eight Low items deferred in `FINDINGS.md`. |
| D1 — images/CSP | `1b3a183` | Articles drop every non-`data:` image; `img-src` loses `https:` in release and dev CSP. |
| D2 — error log | `a22bddc` | `reportError` + global handlers; Rust rotating log (512 KB, one previous); Settings path + Open log folder. |
| D3 — version | `b21a9bb` | `pnpm bump-version` updates all five version sources; drift test. |
| D4 — window restore | `e7958c4` | Restored size promoted to 720×560, still fitted to smaller work areas; Rust unit tests. |
| D5 — release docs | `dd2041d` | Root README, `RELEASE.md` installer checklist, CHANGELOG 0.1.0, search-field focus rings, Node 26-compatible perf harness, session/task records, repo hygiene. |
| E — acceptance | this report | Linux matrix below; Windows items marked blocked. |

## Acceptance matrix

### Clean profile (Linux-simulated / Windows pending)

| Check | Result | Evidence |
|---|---|---|
| Fresh state boots to setup step 1 (`look`) | pass (logic) | `tests/setupFlow.test.tsx` boot-rule cases |
| Step 1 Skip then quit resumes at step 2 (`library`) | pass (logic) | setup flow tests: skip writes only the prefs flag |
| Saving step 2 lands in Library; tour does not auto-open | pass (logic) | setup flow tests; tour only opens via `replayTour()` |
| Step label comes from the machine | pass | setup flow tests assert “Step 1/2 of 2” |
| No scrollbar at 720×560 | not executable here | media/overflow contract asserted in Part B CSS; needs webview |
| Import EPUB/HTML/TXT | pass (logic) | `tests/import.test.ts` 20/20 |
| Remote image in HTML not loaded | pass (logic) | sanitizer test drops remote/protocol-relative/relative `<img>` |
| Error log writes and opens | pass (unit) | `tests/errorLog.test.ts` 4/4; Rust commands unbuilt |
| Backup export/restore round-trip | pass (logic) | `tests/backup.test.ts` 20/20 |
| Installer installs per-user, shortcuts, uninstall | **blocked** | needs Windows + `pnpm tauri:build` |

### Existing library

| Check | Result | Evidence |
|---|---|---|
| Setup/tour skipped when documents exist | pass (logic) | setup flow boot-rule tests |
| Schema-1 byte-identical round-trip | pass | `fileStore.roundtrip`, fixture tests |
| Unknown keys preserved | pass | round-trip + unknown-key tests |
| Restore replace is transactional | pass (logic) | backup restore tests |
| Merge interruption leaves partial merge | deferred (C-L1) | documented Low finding; not changed |
| Off-screen/undersized restore clamped | pass (unit logic) | `window_state.rs` tests; Rust not compiled here |
| Upgrade over previous build | **blocked** | needs Windows installer |

## Deferred items

From `FINDINGS.md` (all Low, intentionally not changed):

- C-L1 merge restore is incremental; a write failure mid-merge can leave a
  valid but partially merged library (replace is transactional).
- C-L2 rollback directories are ordered lexicographically (correct for
  fixed-width epoch ms; clock rollback can reorder).
- C-L3 inline `style="url(...)"` and CSS `@import` assets are not rewritten.
- C-L4 self-referential author CSS could recurse (hostile-input hardening).
- C-L5 non-Unicode launch paths are skipped rather than opened.
- C-L6 Collections create/rename do not submit on Enter and lack inline busy
  labels (dialogs disable actions and toast failures).
- C-L7 one `frameDpr` is shared across spine frames; mixed-DPI monitors can
  make selection coordinates slightly off.
- C-L8 non-`http(s)` external schemes are not surfaced.

Windows-only deferrals: installer/signing/SmartScreen, real webview setup
layout, file-association launch, Narrator, display scaling, page-turn/cold-open
paint budgets (FT-002, FT-005 runtime, FT-006 runtime, FT-007 interruption).

## Exact verification commands

### Linux (run here)

```bash
cd desktop
./node_modules/.bin/tsc -b                                  # clean
./node_modules/.bin/vitest run                              # 315/315, 43 files
./node_modules/.bin/vite build                              # success
node --import ./scripts/perf-register.mjs scripts/perf.ts   # exit 0
```

Focused acceptance subset:

```bash
cd desktop
./node_modules/.bin/vitest run \
  tests/setupFlow.test.tsx tests/backup.test.ts tests/import.test.ts \
  tests/errorLog.test.ts tests/version.test.ts tests/reader.test.ts
```

### Windows (must be run before shipping)

```powershell
cd desktop
pnpm install --frozen-lockfile
pnpm exec tsc -b
pnpm exec vitest run
pnpm exec vite build
cd src-tauri
cargo test --all-targets
cargo fmt --all -- --check
cd ..
pnpm perf
pnpm tauri:build
```

Then execute the clean-profile + existing-library checklist in
`docs/development/RELEASE.md` (installer, file associations, tour opt-in,
error log, backup round-trip, off-screen restore, uninstall preserves data,
privacy/CSP, Narrator/scaling).

## Evidence

- Typecheck: `tsc -b` exit 0.
- Tests: **315 passed / 43 files** (`vitest run`).
- Build: `vite build` success (existing >500 kB chunk warning only).
- Perf (`/tmp/opencode/perf-0.1.0.json`): `reader_parse_openEpubFromBytes`
  441.42 ms (≤ 1200 ms), `locator_decode_200` 0.26 ms (≤ 400 ms);
  `import_parseEpub` 8477.7 ms is informational (no §12 budget) and slower on
  this loaded host than the 2026-10-31 baseline (6349.82 ms), so it remains an
  optimization candidate, not a release gate.
- Rust/Tauri: not run — `cargo` has no installed toolchain on this Linux host;
  webkit2gtk/gtk3 are absent.
- Git: commits listed above are local only, not pushed.

## Release decision

Hold the 0.1.0 tag until the Windows checklist passes. If a defect appears,
fix it against the corresponding Part commit, re-run the Linux gate and the
affected Windows checklist rows, and record the result here or in a follow-up
`R-` record.
