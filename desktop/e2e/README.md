# End-to-end smoke (Windows)

WebDriver smoke for the runbook [`P-20261116-01`](../../docs/development/runbooks/E4-webdriver-smoke.md).
It drives the real Tauri app through WebView2 with `tauri-driver` and a raw
W3C WebDriver client — no npm dependency, no `selenium-webdriver` install.

This suite only runs on Windows with a real WebView2 runtime; it is **not**
part of CI.

## Prerequisites

```powershell
cargo install tauri-driver --locked
pnpm exec tauri build --no-sign          # or any build you want to smoke
```

Download `msedgedriver.exe` matching the **WebView2 runtime** version (not the
Edge browser version) and keep it outside the repo:

```powershell
# runtime version: reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv
Invoke-WebRequest "https://msedgedriver.microsoft.com/<version>/edgedriver_win64.zip" -OutFile driver.zip
Expand-Archive driver.zip -DestinationPath C:\tools\edgedriver
```

## First-run profile

The smoke asserts the first-run setup screens. Folio has no data-directory
override, so move the real profile aside and restore it afterwards:

```powershell
$app = "$env:APPDATA\Folio"
$web = "$env:LOCALAPPDATA\com.folio.desktop"   # WebView2 storage: onboarding flags live here
Rename-Item $app "$app.smoke-bak"
Rename-Item $web "$web.smoke-bak"
```

## Run

```powershell
# terminal 1
tauri-driver --port 4444 --native-driver C:\tools\edgedriver\msedgedriver.exe

# terminal 2 (from desktop/) - the default --app is the release binary
node e2e/smoke.mjs

# or point it at another build (absolute path, or relative to desktop/)
node e2e/smoke.mjs --app src-tauri/target/debug/folio-desktop.exe
```

Restore the profile afterwards:

```powershell
Remove-Item "$env:APPDATA\Folio" -Recurse -Force
Remove-Item "$env:LOCALAPPDATA\com.folio.desktop" -Recurse -Force
Rename-Item "$env:APPDATA\Folio.smoke-bak" "$env:APPDATA\Folio"
Rename-Item "$env:LOCALAPPDATA\com.folio.desktop.smoke-bak" "$env:LOCALAPPDATA\com.folio.desktop"
```

## What it asserts

The fixture EPUB is generated in-process (`src/perf/synthEpub.ts`, titled
**Perf Fixture**) and dropped through the webview's HTML5 `drop` path, because
the native picker cannot be automated.

1. First run shows setup step 1; `Continue` advances to step 2.
2. The synthetic drop imports the book and the library lists it.
3. The row opens the reader and the Readium iframe renders `Chapter 1`.
4. `ArrowRight` page turns advance the progress hairline.
5. Quit + relaunch keeps the library and progress; reopening restores the
   saved position.

Not covered (needs manual QA or `withGlobalTauri` plus native dialogs):
highlighting inside the Readium iframe, backup export/restore, and the
open-with/drag-drop OS paths.

Last run: 11/11 checks — see
[`R-20261122-01`](../../docs/development/audits/results/R-20261122-01-windows-gate-reader-upgrade.md).
