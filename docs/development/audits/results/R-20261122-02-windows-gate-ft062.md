# R-20261122-02 — Windows gate on the FT-062 tree and NSIS rebuild

**Date:** 2026-11-22
**Scope:** Re-run the full automated Windows gate on the FT-062 tree
(appearance-panel sections, complete-range EPUB highlight locators,
dark-mode contract audit) — the previous Windows build
([`R-20261122-01`](R-20261122-01-windows-gate-reader-upgrade.md)) predates
that change — and rebuild the 0.1.0 NSIS installer so the latest application
is available for the interactive checks.
**Environment:** Windows 11 Home Single Language, build 26300 (x64);
Intel Core i3-1215U (8 threads); Node 24.18.0; pnpm 11.9.0; Rust 1.97.1.
**Status:** automated gates green, installer rebuilt, release binary launches
and the single-instance hand-off still works. Interactive QA (Narrator,
display scaling, jump-list clicks, open-with/drag-drop, in-webview perf,
highlight painting, updater signing) remains manual per
`WINDOWS-REMAINING.md`.

## Commands and results (from `desktop/`)

| Gate             | Command                                           | Result                                                           |
| ---------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Typecheck        | `pnpm exec tsc -b`                                | exit 0                                                           |
| Lint             | `pnpm run lint` (`eslint . --max-warnings 0`)     | exit 0 (0 errors / 0 warnings)                                   |
| Format           | `pnpm run format:check`                           | clean                                                            |
| Tests            | `pnpm exec vitest run`                            | **776 / 776 passing (99 files)** after one isolated rerun, 111 s |
| Frontend build   | `pnpm exec vite build`                            | green (24.5 s; pre-existing >500 kB chunk warnings)              |
| Perf budgets     | `pnpm perf`                                       | within budget (see below)                                        |
| Rust format      | `cargo fmt --all -- --check`                      | clean                                                            |
| Rust lint        | `cargo clippy --all-targets -- -D warnings`       | clean (1 m 14 s)                                                 |
| Rust tests       | `cargo test --all-targets`                        | **31 passed / 0 failed**                                         |
| Security core    | `cargo test --manifest-path foliocore/Cargo.toml` | **15 passed / 0 failed**                                         |
| Production build | `pnpm exec tauri build --no-sign`                 | NSIS installer produced (release compile 10 m 24 s)              |

Test-run note: the first full Vitest run reported **775 passed / 1 failed** —
`tests/axeSweep.test.tsx` dark-theme `SettingsScreen` exceeded the 5 s
`testTimeout` at 5.38 s under cold-run host load. The file re-ran alone at
**10/10 (2.35 s)** with no product change, matching the documented
host-load flake pattern from `R-20261120-01`. Effective result: 776/776.

## Performance harness (Windows host baseline, FT-062 tree)

Raw JSON:
[`perf-20261122-windows-ft062.json`](perf-20261122-windows-ft062.json)
(2.63 MiB synthetic EPUB, 24 chapters; jsdom DOMParser — the documented
conservative proxy, **not** the in-webview verdict).

| Case                             | Median      | Budget                               | Within |
| -------------------------------- | ----------- | ------------------------------------ | ------ |
| `reader_parse_openEpubFromBytes` | 335.78 ms   | 1 200 ms (parse factor of cold open) | yes    |
| `import_parseEpub`               | 3 201.50 ms | none (informational)                 | —      |
| `import_digest_sha256`           | 7.05 ms     | none (informational)                 | —      |
| `locator_decode_200`             | 0.16 ms     | 400 ms (input side of budget 3)      | yes    |

The reader-parse median is lower than the 2026-11-22 morning run (535.59 ms)
on the same host; both are within budget and the spread is host-load noise,
not a code change.

## Production build and release smoke

| Artifact       | Path                                                                     | Size                        |
| -------------- | ------------------------------------------------------------------------ | --------------------------- |
| Release binary | `desktop/src-tauri/target/release/folio-desktop.exe`                     | 21,761,024 bytes            |
| NSIS installer | `desktop/src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe` | 10,395,418 bytes (9.91 MiB) |

Release smoke (build-tree binary):

- [x] Visible top-level window titled **Folio** (a second visible handle,
      `com.folio.desktop-siw`, is the single-instance plugin's helper window);
      31.5 MB working set after 8 s; `%APPDATA%\Folio\library\manifest.json`
      and `%APPDATA%\Folio\user` present.
- [x] Second launch exits with code 0 in 1.32 s while the first stays up
      (`tauri-plugin-single-instance` hand-off).
- [x] The installer was **not** re-installed over the existing per-user
      install; install/upgrade was verified in `R-20261120-01` and the NSIS
      packaging path is unchanged.

## What remains manual

Per `WINDOWS-REMAINING.md`: item 2 open-with/drag-drop and the `tauri:dev`
read flow; item 3 Narrator, display scaling and jump-list clicks; item 4
in-webview perf verdicts; item 5 updater signing/release (needs the user's
keypair and GitHub secrets); the highlight and backup steps of item 6; item 7
Phase-5 runtime verdicts; and the two open product decisions (watch-folder
auto-import, F10 multiple windows).

## Installed-build verification (2026-11-27)

The 9.91 MiB installer was installed for real on this host on 2026-11-27. Folio
was **not** installed at that point (no uninstall entry, no
`%LOCALAPPDATA%\Folio`), so this is a clean first install of the artifact above,
not an upgrade.

- `Folio_0.1.0_x64-setup.exe /S` → exit 0 in 3.3 s; installed to
  `%LOCALAPPDATA%\Folio` (`folio-desktop.exe` 21,761,024 bytes plus
  `uninstall.exe`), and an uninstall entry **Folio 0.1.0** was registered under
  HKCU. Start Menu and Desktop shortcuts (`Folio.lnk`) both target the
  installed exe.
- The installed binary differs from the build-tree binary by exactly **3
  bytes**: Tauri's bundler rewrites the placeholder
  `__TAURI_BUNDLE_TYPE_VAR_UNK` to `__TAURI_BUNDLE_TYPE_VAR_NSIS` (offset
  18,369,962). Every other byte matches, so the installed app is this build.
- Launch: visible top-level window **Folio** (the
  `com.folio.desktop-siw` helper is alongside), 47.5 MB working set; second
  launch exits 0 in 0.04 s while the first stays up.
- The profile was empty at install time: `%APPDATA%\Folio\user\window.json`
  was written and `library\` created. `library\manifest.json` is absent because
  the manifest is only written at the first doc mutation (the commit-point
  rule), not on boot — no books were imported in this smoke.
- Open-with, drag-drop and the read flow on the installed build remain manual
  (`WINDOWS-REMAINING.md` item 2).

## Links

- `WINDOWS-REMAINING.md`, `REMAINING.md`
- [`R-20261122-01`](R-20261122-01-windows-gate-reader-upgrade.md) — previous
  gate on the FT-058/059 tree
- `docs/development/sessions/S-20261122-03-appearance-highlighting.md` —
  FT-062 implementation record
