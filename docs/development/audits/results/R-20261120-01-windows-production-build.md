# R-20261120-01 — Windows production gate + NSIS build (0.1.0)

**Date:** 2026-11-20 (local; build finished 2026-11-21)
**Scope:** Execute the Windows-pending verification from
`WINDOWS-REMAINING.md` that can run unattended on a real Windows host, then
produce the 0.1.0 NSIS installer.
**Environment:** Windows 11 Home Single Language, build 26300 (x64);
Intel Core i3-1215U (8 threads), 7.7 GB RAM; WebView2
157.0.4341.60; Node 24.18.0; pnpm 11.9.0; Rust 1.97.1; git
`core.autocrlf` set to `false` for the verification run (see note).
**Status:** automated gates green; production installer built and smoke-run.
Interactive QA (Narrator, display scaling, jump list, WebDriver flow,
updater signing) remains manual — see `WINDOWS-REMAINING.md`.

## Commands and results (from `desktop/`)

| Gate             | Command                                     | Result                                                                                 |
| ---------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Install          | `pnpm install`                              | 408 packages linked (network retried; `--prefer-offline` finished the last 2 packages) |
| Typecheck        | `pnpm exec tsc -b`                          | exit 0                                                                                 |
| Lint             | `pnpm run lint`                             | exit 0 (0 errors / 0 warnings; `--max-warnings 0`)                                     |
| Format           | `pnpm run format:check`                     | clean after LF normalization                                                           |
| Tests            | `pnpm exec vitest run`                      | **725 / 725 passing (92 files)**, exit 0                                               |
| Frontend build   | `pnpm exec vite build`                      | green (29.5 s; pre-existing >500 kB chunk warning)                                     |
| Perf harness     | `pnpm perf`                                 | all cases within budget (table below)                                                  |
| Rust format      | `cargo fmt --all -- --check`                | clean                                                                                  |
| Rust lint        | `cargo clippy --all-targets -- -D warnings` | clean (10m 06s)                                                                        |
| Rust tests       | `cargo test --all-targets`                  | **31 passed / 0 failed**                                                               |
| Security core    | `cargo test -p foliocore --all-targets`     | **15 passed / 0 failed**                                                               |
| Production build | `pnpm exec tauri build --no-sign`           | NSIS installer produced (see below)                                                    |

### Notes on the run

- **Prettier/line endings:** the first `format:check` failed on 29 files
  because the working tree had been checked out CRLF while the committed
  blobs are LF (`.gitattributes` `* text=auto eol=lf`). `prettier --write`
  normalized the files and every resulting blob hash was identical to the
  index (`git diff --numstat` empty); no source change was introduced. The
  host's global `core.autocrlf=true` is the environment cause, so it was set
  to `false` for the working copy.
- **Vitest flake:** the first full run hit five 5 s `testTimeout` failures in
  three files under load (`notesScreen` among them; the suite spent
  1 812 s in jsdom environment setup on this low-power host). The same files
  pass in isolation and the second full run was **725 / 725 green**. This is
  host slowness, not a product regression; no timeout changes were made.
- **Clippy** was run natively on the Windows host (no `windows-gnu`
  cross-check needed) and is warning-free with `-D warnings`.

## Performance harness (Windows host baseline)

Raw JSON: [`perf-20261120-windows.json`](perf-20261120-windows.json)
(2.63 MiB synthetic EPUB, 24 chapters, jsdom DOMParser — the documented
conservative proxy; **not** the in-webview verdict).

| Case                             | Median      | Budget                               | Within |
| -------------------------------- | ----------- | ------------------------------------ | ------ |
| `reader_parse_openEpubFromBytes` | 421.39 ms   | 1 200 ms (parse factor of cold open) | yes    |
| `import_parseEpub`               | 4 451.24 ms | none (informational)                 | —      |
| `import_digest_sha256`           | 4.48 ms     | none (informational)                 | —      |
| `locator_decode_200`             | 0.13 ms     | 400 ms (input side of budget 3)      | yes    |

The real cold-open / page-turn / 200-highlight verdicts still need the
in-webview ceremony described in
[`R-20261031-02`](R-20261031-02-performance-method.md) (budgets 1–3).

## Production build and release smoke

Build command: `pnpm exec tauri build --no-sign` (unsigned until the updater
keys from `P-20261116-02` exist; CI uses the same flag).

| Artifact       | Path                                                                     | Size                        |
| -------------- | ------------------------------------------------------------------------ | --------------------------- |
| Release binary | `desktop/src-tauri/target/release/folio-desktop.exe`                     | 21,732,352 bytes            |
| NSIS installer | `desktop/src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe` | 10,369,606 bytes (9.89 MiB) |

Release smoke (installed build):

- [x] Release binary launches; window titled **Folio** stays up (15 s
      observation), and `%APPDATA%\Folio\{library,user}` resolve with
      `library/manifest.json` present.
- [x] Second launch exits immediately while the first stays up
      (`tauri-plugin-single-instance` hand-off).
- [x] `Folio_0.1.0_x64-setup.exe /S` returns 0 and upgrades the existing
      per-user install in `%LOCALAPPDATA%\Folio` in place; registry entry
      `Folio 0.1.0` and its uninstall string remain correct.
- [x] Installed `folio-desktop.exe` reports FileVersion/ProductVersion
      `0.1.0`, launches, and shows the **Folio** window.
- [!] Open-with: launching the installed app with an existing library EPUB
  keeps the process healthy, but open-with imports through the normal
  import path, so a duplicate prompts the dedup dialog — full open-with
  verdict still needs an interactive run (a new file would confirm the
  import, but it would leave a smoke document in the real library).

## What remains manual

Per `WINDOWS-REMAINING.md`: Narrator pass, display scaling at
100/125/150/200 %, taskbar jump-list behaviour, WebDriver smoke
(`P-20261116-01`), updater signing + release flow (`P-20261116-02`),
Phase-5 runtime verdicts, and the open product decisions (watch-folder,
multiple windows).

## Links

- `WINDOWS-REMAINING.md`, `REMAINING.md`
- `docs/development/RELEASE.md`
- FT-057 in `docs/development/TASKS.md`
