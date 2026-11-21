# E4 runbook — WebDriver smoke (Windows session)

**ID:** `P-20261116-01` · **Status:** pending execution (Windows-only)
**Source:** Production-readiness plan Phase 4 Step 4.3 (E4)
**Why here:** `tauri-driver` and the app's WebView2 host are Windows-only;
the Linux dev box cannot execute this suite, so the procedure is recorded
exactly for a Windows session to pick up.

The plan's "jest-axe checks" item is already satisfied by the Vitest axe
sweep (`desktop/tests/axeSweep.test.tsx`, FT-039) — do not add jest-axe.

## 1. Prerequisites (Windows 10/11)

- WebView2 Runtime (ships with Win11; installer otherwise).
- Edge stable installed (tauri-driver downloads the matching `msedgedriver`
  automatically on Windows).
- Node 22 + pnpm 11 (same as CI).
- Rust toolchain.

```powershell
cd src-tauri
cargo install tauri-driver --locked
cd ..
pnpm install
pnpm tauri:build          # produces target/release/folio-desktop.exe + NSIS installer
```

## 2. Enable the global Tauri API for the smoke build

`window.__TAURI__` is **not** exposed in production (least surface). For the
smoke build only, flip it in `desktop/src-tauri/tauri.conf.json`:

```json
"app": { "withGlobalTauri": true, ... }
```

Build, run the smoke, then **revert** this change before committing.

## 3. Start the driver + client skeleton

```powershell
# terminal 1 (WebDrivers get cached under %LOCALAPPDATA%\tauri-driver)
tauri-driver --port 4444
```

`desktop/e2e/smoke.mjs` (create it; skeleton — npm i -D selenium-webdriver):

```js
import { Builder, Capabilities, until, By } from "selenium-webdriver";

const capabilities = new Capabilities();
capabilities.set("tauri:options", {
  application: "../src-tauri/target/release/folio-desktop.exe",
});
const driver = await new Builder()
  .usingServer("http://localhost:4444")
  .withCapabilities(capabilities)
  .build();

try {
  // ... the flow below; every app call goes through window.__TAURI__
  await driver.wait(until.elementLocated(By.css(".folio-library")), 20_000);
} finally {
  await driver.quit();
}
```

Run with `node e2e/smoke.mjs`. Selection hints: the app mounts
`aria-label`/`data-tour` attributes on nav items (`data-tour="nav-settings"`
etc.) and `.folio-*` class hooks throughout — prefer `By.css` with those.

## 4. Flow to assert (per plan E4)

1. **First run** — app opens into setup/onboarding; complete it via UI
   clicks; library shows the empty state.
2. **Import** — native dialogs can't be automated; use the webview's own
   HTML5-drop path (`filesFromDataTransfer` accepts real `File` objects):
   a. Stage a fixture EPUB inside the app dir (the path guard accepts
   app-dir paths without a grant) via script. `fs_write_atomic` is a raw
   IPC write — bytes as the body, the path in a header:
   ```js
   const bytes = new Uint8Array(/* fixture .epub, e.g. from tests/fixtures */);
   await driver.executeScript(
     `
     const b64 = arguments[0];
     const bin = atob(b64);
     const bytes = new Uint8Array(bin.length);
     for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
     return window.__TAURI__.core.invoke(
       "fs_write_atomic",
       bytes,
       { headers: { "x-folio-path": "<appdir>/user/incoming/smoke.epub" } },
     );
   `,
     base64Fixture,
   );
   ```
   (Get `<appdir>` via `invoke('library_path')`; pass the fixture as
   base64 in `arguments` — WebDriver script args must be JSON-safe.)
   b. In-script: read it back via `invoke('fs_read', { path })`
   (returns an ArrayBuffer), build
   `new File([bytes], 'smoke.epub')` + `DataTransfer`, and dispatch a
   synthetic `drop` event on the library drop surface.
   c. Assert the new row appears in the library list.
3. **Open** — click the row (or route via `data-tour`), assert the reader
   canvas mounts and chapters render.
4. **Highlight** — select a text range (double-click a word) and apply a
   highlight through the selection popover; assert the annotation is
   persisted (re-select shows it / Notes screen lists it).
5. **Close / reopen resume** — quit the process; relaunch with the same
   capabilities; the app must reopen on the same document and position
   (progress restore). Assert scroll position % matches.
6. **Backup export/restore** — native save dialog again; invoke-driven:
   `invoke('backup_export', { destPath: '<appdir>/user/smoke-backup.zip' })`
   (`guard_sandboxed` requires the dest inside the app dir); assert the
   returned summary, then exercise the restore flow through Settings (it
   validates with `backup_inspect` and rewrites the library via fs
   commands) and assert the manifest round-trips.

Record results (pass/fail per step + console errors) into the FT-040 row in
`docs/development/TASKS.md`.

## 5. Known gaps (do not count as smoke failures)

- Native file/save dialogs themselves (import pick, backup dest, reveal in
  Explorer) remain Windows manual-QA items — the smoke drives around them
  with a synthetic HTML5 drop and invoke-driven export.
- `withGlobalTauri` stays off in production builds; flip it only for the
  smoke build and revert.
