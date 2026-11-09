# Folio Desktop

A Windows-first EPUB reader for a calm, local reading library. Folio is built
with **Tauri 2 + React 18 + TypeScript**; the UI is in `desktop/`.

**Current release: 0.1.0** — see [`CHANGELOG.md`](CHANGELOG.md) and the
[release verification checklist](docs/development/RELEASE.md).

## What it does

- Imports EPUB books plus HTML/TXT articles; PDFs are rejected with a clear
  message.
- Reads with themes, typefaces, text size, line spacing, page flow
  (paged/scrolled), reading width, justification and hyphenation.
- Saves reading position, reading pace and per-book overrides.
- Highlights, notes, bookmarks, collections, library search and in-book search.
- Exports and restores a versioned backup zip (merge or replace).
- Restores window geometry, follows the system theme, and keeps the display
  awake while reading if requested.

Everything stays on the machine. There is **no telemetry, analytics or network
request**; Google Drive sync was removed in October 2026.

## Requirements

| | |
|---|---|
| Run (release) | Windows 10/11 x64, WebView2 (installed by the NSIS installer when missing) |
| Develop | Node 22.18+ and pnpm 11; Rust stable with the Tauri Windows prerequisites |
| Build | `pnpm tauri:build` on Windows; the full Tauri/Rust build is **Windows-first** |

The Linux development host can run typecheck, Vitest and the Vite build only;
see [AGENTS.md](AGENTS.md).

## Commands (from `desktop/`)

```bash
pnpm install            # dependencies (CI: pnpm 11 / Node 22)
pnpm exec tsc -b        # typecheck
pnpm exec vitest run    # unit tests
pnpm exec vite build    # frontend build
pnpm perf               # deterministic performance harness
pnpm tauri:dev          # dev app (Windows webview required)
pnpm tauri:build        # NSIS installer
pnpm bump-version X.Y.Z # update every version source + version test
```

Rust checks:

```bash
cd desktop/src-tauri
cargo test --all-targets
cargo fmt --all -- --check
```

## Data layout

The TypeScript layer owns the library layout under the virtual root
`/folio-library`; Rust maps it to `%APPDATA%\Folio` (`library/`, `user/`,
`manifest.json`). `manifest.json` is the commit point and is written last.
Schema-1 library files remain readable and unknown keys are preserved.

Diagnostics stay local: unhandled errors append to
`%APPDATA%\Folio\user\logs\folio.log` (512 KB rotation, one previous file).
Settings → About → **Open log folder** reveals it.

## Documentation

- [`AGENTS.md`](AGENTS.md) — mandatory operating rules and invariants.
- [`docs/development/`](docs/development/README.md) — architecture, task board,
  decisions, audits and session history.
- [`docs/development/RELEASE.md`](docs/development/RELEASE.md) — installer,
  upgrade and privacy verification.
- [`FINDINGS.md`](FINDINGS.md) — Part C review record and deferred items.
- [`.docs/`](.docs/README.md) — product/design specifications (source of truth).

## Known limitations

- EPUB, HTML and TXT only; PDF import is intentionally unsupported.
- Local-only by design: no sync, accounts or cloud storage.
- Windows installer, Narrator and display-scaling verdicts are tracked on the
  release checklist and are not yet verified for 0.1.0.
