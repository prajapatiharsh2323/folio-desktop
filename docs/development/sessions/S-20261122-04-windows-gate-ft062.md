# S-20261122-04 — Windows gate on the FT-062 tree and latest NSIS build

**Session:** 2026-11-22 (evening), main checkout, Windows 11 host
**Objective:** run the automated Windows gate on the current tree and produce
the latest installer, so the interactive checklist in `WINDOWS-REMAINING.md`
can be executed against it.
**Status:** complete for the automated half. No product code changed; the
working-tree changes are documentation only.

## Why this session existed

The last Windows build and gate (`R-20261122-01`) ran on the FT-058/059 tree.
FT-062 (`9d8a238` — appearance-panel sections, complete-range EPUB highlight
locators, dark-mode contract audit) landed afterwards and had only Linux
verification (`S-20261122-03`). Every other open item in `TASKS.md` is
interactive QA or blocked on the user's updater keypair, so the only
outstanding automated work was: re-run the full gate on FT-062, rebuild the
installer, and smoke the release binary.

## Actions

1. Ran the full gate from `desktop/`: `tsc -b`, `eslint . --max-warnings 0`,
   `prettier --check .`, `vitest run`, `vite build`, `pnpm perf`,
   `cargo fmt --check`, `cargo clippy -D warnings`,
   `cargo test --all-targets`, foliocore tests via `--manifest-path`.
2. Built the installer with `pnpm exec tauri build --no-sign` (updater keys
   still pending, `P-20261116-02`).
3. Smoke-tested the release binary: launch, visible-window enumeration
   (Win32 `EnumWindows`), working set, app directories, second-launch
   single-instance hand-off.
4. Recorded the evidence as `R-20261122-02` plus
   `audits/results/perf-20261122-windows-ft062.json`, and updated
   `TASKS.md` (FT-063), `REMAINING.md`, `WINDOWS-REMAINING.md`,
   `CURRENT_SESSION.md` and both audit indexes.

## Verification evidence

- `tsc -b` exit 0; ESLint 0 errors / 0 warnings; Prettier clean.
- **Vitest 776/776 (99 files)**. The first full run was 775 passed + 1 failed:
  `tests/axeSweep.test.tsx` dark-theme `SettingsScreen` hit the 5 s
  `testTimeout` at 5.38 s under cold-run host load. The file re-ran alone at
  **10/10 (2.35 s)** with no code change — the same host-load flake documented
  in `R-20261120-01`.
- `vite build` green (24.5 s); only the pre-existing dynamic-import and
  chunk-size warnings.
- Perf within budget: `reader_parse` **335.78 ms** vs 1 200 ms;
  `locator_decode_200` **0.16 ms** vs 400 ms. Lower than the morning run
  (535.59 ms) on the same host; both in budget, spread is host-load noise.
- `cargo fmt` clean; clippy `-D warnings` clean (1 m 14 s);
  `cargo test --all-targets` **31 passed**; foliocore **15 passed**.
- `tauri build --no-sign`: release compile **10 m 24 s**;
  `folio-desktop.exe` 21,761,024 bytes; `Folio_0.1.0_x64-setup.exe`
  **10,395,418 bytes (9.91 MiB)**.
- Release smoke: visible top-level window **Folio** (the second visible handle,
  `com.folio.desktop-siw`, is the single-instance plugin's helper), 31.5 MB
  working set, `%APPDATA%\Folio\library\manifest.json` and
  `%APPDATA%\Folio\user` present, second launch exits 0 in 1.32 s while the
  first stays up.

## Decisions

- The gate ran against the real `%APPDATA%\Folio` profile for the launch smoke
  (matching `R-20261120-01`); no library data was modified and no WebDriver
  session was needed this time.
- The installer was **not** re-installed over the existing per-user install:
  install/upgrade was already verified in `R-20261120-01` and NSIS packaging is
  unchanged. The fresh `Folio_0.1.0_x64-setup.exe` is available on disk.
  (Superseded 2026-11-27: no install existed on the host any more, so the
  artifact was installed for real — see the follow-up below.)
- No code fix was warranted for the single Vitest timeout — isolated rerun
  green, pre-existing documented host-load pattern.

## Unresolved / manual

Everything left is interactive or credential-blocked (`WINDOWS-REMAINING.md`):
item 2 open-with/drag-drop and the `tauri:dev` read flow; item 3 Narrator,
display scaling 100/125/150/200 % and jump-list clicks; item 4 in-webview perf
verdicts; item 5 updater signing/release (`P-20261116-02`, needs the keypair
and GitHub secrets); the highlight-painting and backup export/restore steps of
item 6; item 7 Phase-5 runtime verdicts; and the open product decisions
(watch-folder auto-import, F10 multiple windows).

## Follow-up 2026-11-27 — installed-build verification

The artifact was installed on this host (Folio was not installed any more — no
uninstall entry, no `%LOCALAPPDATA%\Folio`):

- `Folio_0.1.0_x64-setup.exe /S` → exit 0 in 3.3 s; `%LOCALAPPDATA%\Folio`
  contains `folio-desktop.exe` (21,761,024 bytes) and `uninstall.exe`; an
  uninstall entry **Folio 0.1.0** is registered under HKCU.
- The installed exe differs from the build-tree exe by exactly **3 bytes** —
  Tauri's bundler rewrites `__TAURI_BUNDLE_TYPE_VAR_UNK` to
  `__TAURI_BUNDLE_TYPE_VAR_NSIS` at offset 18,369,962 — so it is this build.
- Launch: visible window **Folio**, 47.5 MB working set; second launch exits 0
  in 0.04 s while the first stays up. Empty profile initialised
  (`user/window.json`, `library\`); no `library/manifest.json` because the
  manifest is only written at the first doc mutation and no book was imported.
- WebView2 runtime is now **158.0.4370.45**; a future WebDriver smoke needs the
  matching `msedgedriver` (the last one used 157.0.4341.60).
- Evidence appended to `R-20261122-02`; `WINDOWS-REMAINING.md` item 2,
  `REMAINING.md`, `TASKS.md` (FT-063) and `CURRENT_SESSION.md` updated.

## Exact next action

Execute the interactive checklist in `WINDOWS-REMAINING.md` against
`desktop/src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe`
(or the uninstalled build-tree binary), starting with item 2. Nothing is
unblocked as code work.
