# Folio Desktop — Windows Session Checklist

Everything that **cannot be finished on the Linux dev box** — a Windows
machine must run these to declare the app production-ready. Work top to
bottom; each item records its exact procedure and pass criteria.

Updated: 2026-11-18 — **CI is fully green** (run `44259919408`); items 2–8 below remain.

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

## 2. Release smoke on real Windows hardware

- [ ] `pnpm tauri:dev` launches; import → open → read → close → reopen.
- [ ] `pnpm tauri:build` produces the NSIS installer; install it; the
      installed app starts and creates `%APPDATA%/Folio/{library,user}`.
- [ ] Open-with: double-click an `.epub` / `.html` / `.txt` in Explorer →
      app opens that book (single-instance hand-off, `folio://launch`).
- [ ] Drag-drop a file onto the window imports it (grant-then-read path).

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

- [ ] Cold open ≤ **1.2 s**
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
