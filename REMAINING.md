# Folio Desktop — Remaining Work (Windows / CI)

Status as of the production-readiness pass (2026-11-17). Items are checked
when implemented **and** verified locally (tests/build); runtime-only checks
are called out explicitly.

## Build / platform (Phase 11)

- [x] Rust toolchain + Windows build deps; `cargo test` green (28 tests).
- [x] Release binary starts and creates `%APPDATA%/Folio/{library,user}`
      (10-second smoke test with the built `folio-desktop.exe`).
- [x] `pnpm tauri:dev` launches the app (dev smoke test; Vite ignores
      `src-tauri/**` so cargo's locked debug DLL cannot crash the watcher).
- [x] `pnpm tauri:build` produces the NSIS installer:
      `desktop/src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe`
      (4.10 MiB).
- [x] File associations (`.epub`, `.html`/`.htm`, `.txt`) in `tauri.conf.json`.
- [x] Single-instance handling + open-with hand-off (`open_files.rs`, `folio://launch`).
- [x] Taskbar jump list ("Open Folio" / "Import file…")
      (`src-tauri/src/jumplist.rs`, COM `ICustomDestinationList`, no extra
      dependency; compiled against the `x86_64-pc-windows-gnu` target and
      fmt/tests checked — **runtime taskbar behaviour still needs a real
      Windows run**).
- [x] Window size/position restore, clamped to the monitor work area
      (`window_state.rs`, preserves unknown `window.json` keys).
- [x] Native F11 fullscreen + Escape exit (`src/lib/fullscreen.ts`, `Shell.tsx`).
- [ ] OS display-scaling check (100/125/150/200%) on real hardware.

## Phase 9 — Drive sync (removed 2026-10-31)

> The feature shipped behind the items below, but was **removed entirely**
> (code, OAuth, CSP grants, settings card — see D-20261031-03). The ZIP
> backup (`desktop/src/backup/`, Settings → Backup) is the only
> library portability path. The checklist is kept as a historical record;
> the former `sync/` module, `src-tauri/src/oauth.rs`, `CloudSyncSection`,
> `SyncScheduler`, and `tests/sync.test.ts` no longer exist.

- [x] Loopback OAuth desktop client: system browser, PKCE S256, ephemeral
      `127.0.0.1` listener, refresh token in Windows Credential Manager,
      scope `drive.file` (`src-tauri/src/oauth.rs`).
- [x] `sync/` module: `Folio Library/` layout, `sync/state.json` drive/sha map,
      newest-wins merge, deletions-never-propagate, user JSON per-id merge,
      docId remap on identical contentHash, manifest uploaded last, failure
      classification (`src/sync/`, 9 Vitest cases).
- [x] `CloudSyncSection`: connect + first-sync consent, Sync now, disconnect,
      opt-in 15-minute auto-sync, status/failure banner + Retry.
- [x] Rust-side HTTP (`reqwest`) token exchange with native TLS.
- [ ] End-to-end run against Google Drive with a real OAuth Desktop client ID
      (moot — credentials were never in the repo and the feature is removed).

## Phase 10 — Dictionary (removed 2026-10-31)

> The entire offline-dictionary feature was **removed** after the
> 2026-10-31 application audit — the pack asset could never be built here
> (the `mobile/` tree is not in this repo) and a dormant `rusqlite`/UI
> integration was cost without benefit.
> See `docs/development/decisions/D-20261031-05-dictionary-removal.md`.
> The bullets below are the historical pre-removal state.

- ~~Bundle the SQLite pack produced by `mobile/tools/build_dict.py`~~
  (superseded by the removal).
- ~~`dict_sqlite_query` / `dict_lookup` / `dict_status`~~ _(removed)_.
- ~~Meaning card, Settings→About dictionary rows~~ _(removed)_.
- `tests/noDictionary.test.ts` now guards against re-introduction.

## Phase 11 — Polish

- [x] Performance budget checks (04 §12): cold open ≤ 1.2 s, page turn ≤ 80 ms,
      200 highlights ≤ 400 ms — harness + method + Linux baseline done
      (`scripts/perf.ts`; reader-parse 316 ms). **Runtime verdicts still need
      a real Windows run** (procedure in `docs/development/audits/results/`).
      CI now fails the build when a budget is exceeded (perf-report artifact).
- [x] Accessibility pass (03 §7): focus rings, tab order, ARIA, contrast —
      code-side pass complete (Phase 4 X2–X4: axe sweep over all four screens
      in both themes, forced-colors + high-contrast support, inert app root
      under modals, 12 px min text, skeleton a11y). **Screen-reader runtime
      verdict (Narrator) still needs a real Windows run.**
- [x] CI workflow (`.github/workflows/desktop-ci.yml`): Windows runner, pnpm,
      tsc, ESLint, Prettier check, Vitest, Vite build, perf budgets,
      `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, NSIS
      build + installer artifact; separate ubuntu `audits` job
      (`pnpm audit --prod` + RustSec `audit-check`). **Clippy `-D warnings`
      is verified clean locally against `x86_64-pc-windows-gnu`** (2026-11-17,
      FT-046), including a pre-existing unresolved-`backup` compile error that
      would have failed the first run; the `audits` job also had a missing
      `working-directory: desktop` (fixed). **Full CI is green end-to-end**
      as of 2026-11-18 (run `44259919408`, both jobs): tsc/ESLint/Prettier/
      Vitest 725/725/Vite build/perf/clippy/fmt/windows-host `cargo test`/
      NSIS build, plus the ubuntu audits job; the installer artifact
      (`folio-windows-nsis`, 9.88 MiB) was uploaded. CI builds unsigned via
      `pnpm exec tauri build --no-sign` until the updater keys are configured
      (runbook `P-20261116-02`); drop the flag to sign automatically.
- [x] `cargo test` parity for path guard, fs commands, app-dir mapping,
      window-state clamping, launch parsing, (the dictionary tests were
      removed with the feature, 2026-10-31; OAuth helpers were removed with
      Drive sync, 2026-10-31).

## Production-readiness pass (Nov 2026, Phases 1–4)

Completed and committed through `330b1de` (see `docs/development/TASKS.md`
FT-03x rows and `docs/development/CURRENT_SESSION.md`):

- Phases 1–3 (stabilise, reader navigation/navigation UX,
  performance/library) and Phase 4 (X1–X5 shell/a11y/i18n, E4 CI matrix,
  E5 updater wiring + README/notices, E6+E7 fail-loudly startup, session
  tick, synced prefs into the backed-up `user/window.json`, manager cache).
- X5 i18n covers shell chrome (en/hi/ar catalogue, RTL page turns); screen
  copy translation is a deliberate later pass.
- **Windows-pending items (exact runbooks recorded):**
  - `P-20261116-01` — WebDriver smoke (tauri-driver; first run → import →
    open → highlight → resume → backup): `docs/development/runbooks/E4-webdriver-smoke.md`.
  - `P-20261116-02` — updater signing keys, CI secrets, release flow,
    tamper check, Authenticode: `docs/development/runbooks/E5-updater-signing.md`
    (the `plugins.updater.pubkey` placeholder must be replaced first).
  - First CI run on `windows-latest` — **fully green** 2026-11-18 (run
    `44259919408`, FT-046…FT-055): clippy, windows-host `cargo test`, NSIS
    build + installer artifact and the audits job all verified in CI.
  - §12 manual QA: Narrator, display scaling, jump-list taskbar behaviour.

## Phase 5 — feature backlog (Nov 2026)

Shipped and committed (see `docs/development/TASKS.md` FT-043/044/045):

- **F7 folder import** (`746f168`): `pick_import_folder` Rust command +
  recursive TS walk feeding the existing import queue. The folder-picker
  dialog itself needs a Windows run for final verdict.
- **F9 reader extras** (`cc47cc5`): EPUB two-page spread (existing
  `spread` pref → Readium columns, auto at ≥1200 px, resize re-apply),
  line-focus reading band (`L`, Escape ladder, EPUB only).
- **F2 Insights** (`82fa264`): `user/reading-log.json` (daily credited
  reading time, per-book split, backed up), `insights` route with
  today/7-day/30-day totals, streak, optional daily goal, top books.

Windows-pending follow-ups from this phase:

- **Page-turn animation — dropped by decision (2026-11-17).** No Readium
  preference exists and a truthful toggle would need runtime navigator
  research; the user chose to drop the item rather than keep it pending.
  Do not re-scope without asking.
- **Watch-folder auto-import** — deliberate product decision, not built
  (long-lived grant + background watcher).
- EPUB spread `auto`/`both` runtime column behavior in the real webview
  (code + tests verified; Readium degradation verified on Windows only).
- **Per-book reading language — dropped by decision (2026-11-17).** Was
  blocked upstream anyway (`EpubPreferences` has no `language` field in
  navigator 2.14.0); do not re-scope without asking.

Still out of scope (§11 items closed by decision, 2026-11-17): F3
text-to-speech, F5 add-from-URL/clipboard (also needed a network-use
decision), F1 Markdown/CBZ rendering (PDF is done), and F6 lookup
(removed earlier). **F10 multiple windows** is the only §11 item not
formally scoped or dropped — revisit only on request.

## Known limitations

- OS display-scaling checks (100/125/150/200%) need real hardware.
- The app makes no network requests since Google Drive sync was removed
  (2026-10-31); cross-device transfer is via ZIP backup/restore.
- The offline dictionary was removed entirely (2026-10-31,
  D-20261031-05); an earlier install's `%APPDATA%/Folio/dict/` copy is
  orphaned and can be deleted manually.
- Perf/a11y: code-side audit + harness are recorded (`A-20261031-01`,
  `R-20261031-02`); the **runtime** halves (performance verdicts, screen
  reader, jump-list taskbar behaviour) still need a real Windows run (P2;
  jump list is P1 per 09 §3).

## Quick verification commands (run on Windows)

```bash
cd desktop
pnpm install
pnpm exec tsc -b
pnpm exec vitest run
pnpm exec vite build
cargo fmt --all -- --check   # in src-tauri
cargo test                   # in src-tauri
pnpm tauri:dev
pnpm tauri:build             # NSIS installer
```
