# Folio Desktop — Windows Session Checklist

Everything that **cannot be finished on the Linux dev box** — a Windows
machine must run these to declare the app production-ready. Work top to
bottom; each item records its exact procedure and pass criteria.

Updated: 2026-11-21 — **CI fully green** (run `44259919408`) and the
automated gate + NSIS production build re-run on a real Windows 11 host
([`R-20261120-01`](docs/development/audits/results/R-20261120-01-windows-production-build.md)).
Items 3, 5, 6, 7 and the interactive half of 2 remain manual.

## 1. CI run — ✅ fully green (2026-11-18)

Run `44259919408`: both jobs passed on `windows-latest` — tsc, ESLint,
Prettier, Vitest 725/725, Vite build, perf budgets, `cargo fmt --check`,
`cargo clippy -D warnings`, `cargo test --all-targets` (windows host), NSIS
build + installer upload, and the ubuntu audits job. All earlier failures
(unresolved `backup::`, clippy lints, CRLF prettier, zip advisories, audit
permissions, 8.3 short-name guard, Vitest timeouts/midnight flake, updater
signing demands) were fixed in FT-046…FT-055.

- [x] **NSIS installer build in CI** — artifact `folio-windows-nsis`
      (9.88 MiB); locally `desktop/src-tauri/target/release/bundle/nsis/*.exe`.
- [x] **`cargo test --all-targets` on a windows host** — zip 9.6.1 upgrade
      and async `zip.rs` test awaits all executed in CI.

CI builds unsigned via `pnpm exec tauri build --no-sign` until the updater
keys are configured (item 5); drop the flag then to sign automatically.

### Windows 11 host rerun — ✅ 2026-11-21

Same gate executed natively (Windows 11 build 26300, Node 24.18, pnpm 11.9,
Rust 1.97.1): `tsc`, ESLint 0/0, Prettier, **Vitest 725/725 (92 files)**,
Vite build, perf harness within budget, `cargo fmt`, `cargo clippy
-D warnings`, `cargo test --all-targets` (**31 passed**), foliocore
(**15 passed**), and `pnpm exec tauri build --no-sign` → installer
`Folio_0.1.0_x64-setup.exe` (9.89 MiB). Evidence:
[`R-20261120-01`](docs/development/audits/results/R-20261120-01-windows-production-build.md).

## 2. Release smoke on real Windows hardware

- [ ] `pnpm tauri:dev` launches; import → open → read → close → reopen.
- [x] `pnpm exec tauri build --no-sign` produces the NSIS installer; `/S`
      installs it in place; the installed app starts, shows the **Folio**
      window, and `%APPDATA%/Folio/{library,user}` is present.
- [ ] Open-with: double-click an `.epub` / `.html` / `.txt` in Explorer →
      app opens that book (single-instance hand-off, `folio://launch`).
      Automated launch with a file argument stays healthy, but open-with
      routes through import and a duplicate exercises the dedup dialog.
- [ ] Drag-drop a file onto the window imports it (grant-then-read path).

Verified for item 2: release binary launch, single-instance second-launch
hand-off, silent install/upgrade, installed-binary launch
(`R-20261120-01`).

## 3. §12 manual QA (runbook pointers in `REMAINING.md`)

- [ ] **Jump list** — taskbar right-click shows "Open Folio" / "Import
      file…" and both work (`jumplist.rs`; COM code compiled + fmt-checked,
      never run).
- [ ] **Narrator** — navigate Library → Reader → Settings; labels, live
      regions, focus order make sense (code-side axe sweep is green; this
      is the runtime verdict).
- [ ] **Display scaling 100 / 125 / 150 / 200%** — no clipped or blurry UI;
      window-state clamping (`window_state.rs`) still fits the work area.

## 4. Runtime performance verdicts (04 §12)

Procedure: `docs/development/audits/results/`. Budgets (CI also enforces):

- [x] **Harness baseline on the Windows 11 host** (2026-11-20):
      `reader_parse` 421.39 ms vs the 1 200 ms budget factor,
      `locator_decode_200` 0.13 ms vs 400 ms, all cases within budget —
      [`R-20261120-01`](docs/development/audits/results/R-20261120-01-windows-production-build.md)
      / [`perf-20261120-windows.json`](docs/development/audits/results/perf-20261120-windows.json).
      These are jsdom-host numbers, not the in-webview verdicts below.
- [ ] Cold open ≤ **1.2 s** (real webview ceremony)
- [ ] Page turn ≤ **80 ms**
- [ ] 200 highlights ≤ **400 ms**

Record results in `docs/development/audits/results/` and update
`REMAINING.md`.

## 5. Updater signing (runbook `P-20261116-02`)

Full procedure: `docs/development/runbooks/E5-updater-signing.md`.

- [ ] Generate the signing keypair (`pnpm tauri signer generate`); keep the
      private key OUT of the repo (password manager / CI secret only).
- [ ] Replace the `plugins.updater.pubkey` placeholder in
      `desktop/src-tauri/tauri.conf.json` with the real public key.
- [ ] Add `TAURI_SIGNING_PRIVATE_KEY` /
      `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub secrets; re-run CI.
- [ ] Release flow: tag `v*`, installer + `latest.json` artifact, tamper
      check (flip a byte → updater must reject).
- [ ] Authenticode (optional last step): sign the installer.

## 6. WebDriver smoke (runbook `P-20261116-01`)

Procedure: `docs/development/runbooks/E4-webdriver-smoke.md`.

- [ ] tauri-driver end-to-end: first run → import → open → highlight →
      resume → backup round-trip.

## 7. Phase-5 runtime verdicts (shipped 2026-11-17, code verified)

- [ ] **Folder import (F7)** — Library → Import-folder; the native
      `pick_import_folder` dialog opens, recursive walk imports a real
      folder tree (extension filter, caps, skip-hidden verified by tests).
- [ ] **EPUB spread (F9)** — `auto` switches to two-page columns at
      ≥1200 px and re-applies on resize in the real WebView2
      (`resolveEpubColumnCount` verified by tests; Readium degradation is
      the runtime unknown).
- [ ] **Line-focus band (F9)** — `L` toggle renders the band correctly at
      real DPI/scale factors.
- [ ] **Insights (F2)** — read a real book; today/7-day/30-day cards,
      streak, and top books populate after a session
      (`user/reading-log.json` credited from pace deltas).

## 8. Open product decisions (need the user, not Windows)

- [ ] **Watch-folder auto-import** — long-lived grant + background
      watcher; deliberately deferred, build only if asked.
- [ ] **F10 multiple windows** — the only §11 backlog item neither
      shipped nor dropped; revisit on request.

## Commands (from `desktop/`)

```bash
pnpm install
pnpm exec tsc -b
pnpm exec vitest run
pnpm exec vite build
cd src-tauri && cargo fmt --all -- --check && cargo test --all-targets
pnpm tauri:dev
pnpm tauri:build
```

## After the session

Update `REMAINING.md` (check the boxes), append a row to
`docs/development/TASKS.md`, and write the verdicts into
`docs/development/CURRENT_SESSION.md` — run `prettier` on all three.
