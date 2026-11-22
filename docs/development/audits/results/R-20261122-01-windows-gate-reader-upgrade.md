# R-20261122-01 — Windows gate on the reader-upgrade tree, NSIS rebuild, jump list, WebDriver smoke

**Date:** 2026-11-22
**Scope:** Re-run the automated Windows gate on the FT-058/059 tree (the last
Windows build predates the reader upgrade), rebuild the 0.1.0 NSIS installer,
and execute the two Windows-only items that can run unattended: the taskbar
jump-list check (`WINDOWS-REMAINING.md` item 3) and the WebDriver smoke
(`P-20261116-01` / `E4-webdriver-smoke.md`).
**Environment:** Windows 11 Home Single Language, build 26300 (x64);
Intel Core i3-1215U (8 threads); WebView2 runtime 157.0.4341.60; Edge
158.0.4370.33; Node 24.18.0; pnpm 11.9.0; Rust 1.97.1; `tauri-driver` 2.1.0;
`msedgedriver` 157.0.4341.60 (matched to the WebView2 runtime).
**Status:** automated gates green, installer rebuilt, jump-list tasks written
to the shell store, WebDriver smoke 11/11. Highlight-in-reader and
backup-export steps of the runbook remain manual.

## Commands and results (from `desktop/`)

| Gate             | Command                                           | Result                                             |
| ---------------- | ------------------------------------------------- | -------------------------------------------------- |
| Typecheck        | `pnpm exec tsc -b`                                | exit 0                                             |
| Lint             | `pnpm exec eslint . --max-warnings 0`             | exit 0 (0 errors / 0 warnings)                     |
| Format           | `pnpm exec prettier --check .`                    | clean                                              |
| Tests            | `pnpm exec vitest run`                            | **771 / 771 passing (98 files)**, exit 0, 179.1 s  |
| Frontend build   | `pnpm exec vite build`                            | green (32.2 s; pre-existing >500 kB chunk warning) |
| Rust format      | `cargo fmt --all -- --check`                      | clean                                              |
| Rust lint        | `cargo clippy --all-targets -- -D warnings`       | clean (1 m 36 s)                                   |
| Rust tests       | `cargo test --all-targets`                        | **31 passed / 0 failed**                           |
| Security core    | `cargo test --manifest-path foliocore/Cargo.toml` | **15 passed / 0 failed**                           |
| Production build | `pnpm exec tauri build --no-sign`                 | NSIS installer produced (release compile 5 m 34 s) |

Note: `foliocore` is a path dependency, not a workspace member, so its tests
run through `--manifest-path` (the earlier `-p foliocore` form in
`R-20261120-01` does not resolve from `src-tauri/`).

## Performance harness (Windows host baseline)

Raw JSON: [`perf-20261122-windows.json`](perf-20261122-windows.json)
(49 kB synthetic EPUB for the decode case, 2.63 MiB for the parse cases;
jsdom DOMParser — the documented conservative proxy, **not** the in-webview
verdict).

| Case                             | Median      | Budget                               | Within |
| -------------------------------- | ----------- | ------------------------------------ | ------ |
| `reader_parse_openEpubFromBytes` | 535.59 ms   | 1 200 ms (parse factor of cold open) | yes    |
| `import_parseEpub`               | 5 352.47 ms | none (informational)                 | —      |
| `import_digest_sha256`           | 7.74 ms     | none (informational)                 | —      |
| `locator_decode_200`             | 0.26 ms     | 400 ms (input side of budget 3)      | yes    |

## Production build and release smoke

| Artifact       | Path                                                                     | Size                        |
| -------------- | ------------------------------------------------------------------------ | --------------------------- |
| Release binary | `desktop/src-tauri/target/release/folio-desktop.exe`                     | 21,761,024 bytes            |
| NSIS installer | `desktop/src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe` | 10,395,755 bytes (9.91 MiB) |

Release smoke (build-tree binary, current tree):

- [x] Window titled **Folio** stays up; `%APPDATA%\Folio\{library,user}`
      exist with `library/manifest.json`; 34.6 MB working set.
- [x] Second launch exits in 0.2 s with code 0 while the first stays up
      (`tauri-plugin-single-instance` hand-off).

The installer was **not** re-installed over the existing per-user install in
this run; install/upgrade was verified for the 2026-11-20 build in
`R-20261120-01` and the NSIS packaging path is unchanged.

## Jump list (WINDOWS-REMAINING item 3)

Procedure: record the shell's destination-store state, launch the release
binary, wait 14 s, diff the store, decode UTF-16 strings from new files.

Result: launching the app created
`%APPDATA%\Microsoft\Windows\Recent\CustomDestinations\c9ce6eb42f52bdc5.customDestinations-ms`
(2,470 bytes) containing both user tasks and their launch arguments:

```
Open Folio
Import file
D:\folio-desktop\desktop\src-tauri\target\release\folio-desktop.exe   --import
```

So the COM `ICustomDestinationList` code runs and commits the tasks at
startup (previously "compiled + fmt-checked, never run"). Clicking the two
entries from the taskbar menu is still a manual check.

## WebDriver smoke (P-20261116-01)

Setup: `cargo install tauri-driver --locked`; `msedgedriver` 157.0.4341.60
downloaded from `msedgedriver.microsoft.com` to match the WebView2 runtime;
`tauri-driver --port 4444 --native-driver <path>`; dependency-free WebDriver
client (`fetch` + the W3C protocol, no `selenium-webdriver` install).

Profile isolation: the real `%APPDATA%\Folio` and
`%LOCALAPPDATA%\com.folio.desktop` (WebView2 storage, where the onboarding
flags live) were renamed aside before the run and restored afterwards
(57 files back). The app has no data-dir override, so this is the only way to
exercise first-run setup without touching the real library.

| Step | Assertion                                                                    | Result |
| ---- | ---------------------------------------------------------------------------- | ------ |
| 1    | First run shows setup step 1 (`Continue` / `Skip`)                           | pass   |
| 2    | `Continue` advances to "Add your first book"                                 | pass   |
| 3    | Synthetic HTML5 `drop` with a generated 49 kB EPUB (`File` + `DataTransfer`) | pass   |
| 4    | Import completes; library lists **Perf Fixture**                             | pass   |
| 5    | Row opens the reader (`.folio-reader` mounts)                                | pass   |
| 6    | Readium iframe renders `Chapter 1` text                                      | pass   |
| 7    | `ArrowRight` page turns advance the hairline to 66 %                         | pass   |
| 8    | Quit + relaunch: library still lists the book at 66 %                        | pass   |
| 9    | Reopen restores the saved position (hairline 66 %)                           | pass   |

**11 / 11 checks passed** (first attempt: 8/9 — a too-short 45 s reader-mount
timeout; no product defect). Steps not covered, per the runbook's own gaps:
in-reader highlight (requires driving a text selection inside the Readium
iframe) and backup export/restore (needs `withGlobalTauri` plus a native save
dialog). Both stay manual.

## What remains manual

Per `WINDOWS-REMAINING.md`: the interactive half of item 2 (open-with,
drag-drop), item 3 Narrator + display scaling + jump-list clicks, item 4
in-webview perf verdicts, item 5 updater signing/release, the highlight and
backup steps of item 6, item 7 Phase-5 runtime verdicts, and the two open
product decisions.

## Links

- `WINDOWS-REMAINING.md`, `REMAINING.md`
- `docs/development/runbooks/E4-webdriver-smoke.md`,
  `docs/development/runbooks/E5-updater-signing.md`
- FT-061 in `docs/development/TASKS.md`
