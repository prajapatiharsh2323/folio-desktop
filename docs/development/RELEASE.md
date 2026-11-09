# Folio Desktop 0.1.0 — Release Verification

**Release:** 0.1.0 · **Target:** Windows 10/11 (x64), NSIS per-user installer
**Status of this document:** procedures and Linux evidence are current; the
Windows installer/runtime checks must still be executed on a Windows host.

## Artifact

```
desktop/src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe
```

`bundle.windows.nsis.installMode` is `currentUser`: the installer needs no
administrator elevation and installs under the user profile. CI uploads the
same `.exe` as the `folio-windows-nsis` artifact on every successful
`desktop-ci` run.

## Version sources

One version lives in five places; never edit them by hand:

| File | Used for |
|---|---|
| `desktop/package.json` | Vite `__APP_VERSION__` (Settings → About) |
| `desktop/src-tauri/tauri.conf.json` | installer name/version and window metadata |
| `desktop/src-tauri/Cargo.toml` | Rust crate version |
| `desktop/src-tauri/Cargo.lock` | locked `folio-desktop` entry |
| `desktop/src/backup/backupSchema.ts` | `appVersion` written into backups |

Bump all five and fail the build on drift:

```bash
cd desktop
pnpm bump-version 0.1.1     # or: node scripts/bump-version.mjs 0.1.1
pnpm exec vitest run tests/version.test.ts
```

Then add the CHANGELOG entry and rebuild. The bump script is idempotent and
exits non-zero on a malformed version or a missing pattern.

## Automated gate (must be green before building)

Linux (this repository's development host):

```bash
cd desktop
pnpm exec tsc -b
pnpm exec vitest run
pnpm exec vite build
```

Windows / CI (`windows-latest`, also run by `.github/workflows/desktop-ci.yml`):

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
pnpm tauri:build
```

Record the test count and installer size in the release notes. The current
Linux baseline is **315 Vitest tests / 43 files**, `tsc -b` clean, `vite build`
successful. Rust/Tauri commands cannot run on this Linux host (no Rust
toolchain, no webkit2gtk), so CI is the authoritative Rust gate.

## Windows installer checklist

Run on a clean Windows profile **and** on a profile with an existing Folio
library. Tick each item in the release issue.

### Clean profile

- [ ] Installer launches without an elevation prompt and completes.
- [ ] Start-menu entry opens Folio; the window appears at 1100×760 (or the
      monitor's working size if smaller), centred, and the minimum size stops
      at 720×560.
- [ ] First run shows the two-screen setup (`look` → `library`), not the tour.
- [ ] Step 1 **Skip** → app opens; quit before step 2 → next launch resumes at
      the library screen (not step 1).
- [ ] Saving step 2 lands in the Library; the tour does not auto-open.
      Settings → About → **Replay tour** is the only way to reopen it.
- [ ] Import an EPUB, an HTML file and a TXT file; each appears on the shelf
      and opens.
- [ ] Open-with / double-click an `.epub`, `.html` and `.txt` file; Folio
      becomes the viewer for the current user.
- [ ] Settings shows the real version (`0.1.0`) and opens the library folder.
- [ ] Settings → **Error log → Open log folder** opens
      `%APPDATA%\Folio\user\logs`; `folio.log` exists after an induced error.
- [ ] Export a backup, restore it with **Replace**, and confirm books,
      collections, notes, reading positions and settings return.
- [ ] Uninstall removes the program; `%APPDATA%\Folio` (library data) is left
      intact and a reinstall reopens the existing library.

### Existing-library profile

- [ ] Setup/tour are skipped when documents already exist.
- [ ] The window restores its previous size/position; if that position is now
      off-screen it reopens reachable (title bar visible).
- [ ] Schema-1 `manifest.json` / `meta.json` files from the previous build load
      without migration prompts and survive a read-only open + close.
- [ ] Interrupting a **replace** restore (kill the app mid-restore) leaves the
      previous library intact on the next launch. A merge starts committing as
      it goes (documented Low finding C-L1), so verify interruption only for
      replace.

### Upgrade / packaging

- [ ] Installing over an older per-user build upgrades in place without
      duplicate Start-menu entries.
- [ ] If `TAURI_SIGNING_PRIVATE_KEY` is configured, the installer is signed and
      shows no "unknown publisher" warning; otherwise record that it is
      unsigned (SmartScreen may warn).
- [ ] Uninstall entry appears in Settings → Apps, with the correct version.
- [ ] Installer artifact size is recorded and compared with the previous
      release.

## Privacy / CSP gate

- [ ] The app makes no network requests during import, reading, search,
      backup or restore (check the webview devtools Network panel; the only
      `connect-src` entries are IPC/dev-server URLs).
- [ ] Release CSP is
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
      img-src 'self' asset: data: blob:; font-src 'self' data:;
      frame-src 'self' blob: data:; connect-src 'self' ipc: http://ipc.localhost`
      with no `https:` image source.
- [ ] An HTML article containing a remote `<img>` renders without loading it
      (the sanitizer drops the element).
- [ ] External `http(s)` links open in the system browser; other schemes do
      not.

## Accessibility / performance spot checks

- [ ] Keyboard-only pass: Tab reaches every control with a visible focus ring;
      dialogs and panels trap focus and return it on close; Escape closes only
      the topmost surface.
- [ ] Narrator announces dialog titles, selection-group labels and the setup
      step label; icon-only buttons read their `aria-label`.
- [ ] Display scaling at 100 / 125 / 150 / 200 % keeps the reader chrome and
      setup usable (FT-002).
- [ ] `pnpm perf` on the release build: cold open ≤ 1.2 s, page turn ≤ 80 ms,
      200 highlights ≤ 400 ms (method: `docs/development/audits/results/R-20261031-02-performance-method.md`).

## Known limitations for 0.1.0

- PDF files are deliberately rejected with a clear message.
- Google Drive sync was removed (2026-10-31); the app is local-only and makes
  no network requests.
- Non-Unicode file names passed via launch arguments are skipped rather than
  opened (the frontend path model is UTF-8).
- Runtime, installer, Narrator and display-scaling verdicts remain unverified
  on this Linux development host; use the checklist above on Windows.

## Rollback

No in-app rollback. To recover from a bad release, uninstall it and reinstall
the previous `Folio_<version>_x64-setup.exe`; library data in `%APPDATA%\Folio`
is not removed by the uninstaller. Restore from a Settings → Export backup if
documents were modified.
