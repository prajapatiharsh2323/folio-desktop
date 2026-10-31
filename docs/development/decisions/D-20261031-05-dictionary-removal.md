# D-20261031-05 — The offline dictionary is removed entirely

**Status:** adopted 2026-10-31
**Supersedes:** FT-004 (bundle the SQLite dictionary pack — alternative to
shipping the asset), Phase 10 feature work in `desktop/README.md`
**Affects:** `desktop/src/` (meaning card + dict bridge deleted),
`desktop/src-tauri/` (`commands/dict.rs`, resource bundling, `rusqlite`),
`desktop/src/screens/SettingsScreen.tsx`, `desktop/src/components/SelectionToolbar.tsx`

## Context

The dictionary (Phase 10) shipped code-complete but its release asset never
existed in this repo: the pack is built by `mobile/tools/build_dict.py`, and
the `mobile/` tree is not available here, so FT-004 stayed blocked. The
runtime UI already could not be exercised: "Meaning — Phase 10" in the
selection toolbar and "Add bookmark — Phase 5"-style dead entries made the
reader surface confusing, and `rusqlite` (bundled SQLite) was linked into the
thin Rust core for a feature with no data source. The 2026-10-31 application
audit recommended full-stack removal rather than a dormant integration.

## Decision

1. **Remove the feature entirely.** Deleted:
   `desktop/src/components/MeaningCard.tsx`, `desktop/src/dict/lookup.ts`,
   `desktop/src/dict/normalise.ts`, `desktop/src-tauri/src/commands/dict.rs`,
   `desktop/src-tauri/dict/README.md`; removed the `Meaning` action from
   `SelectionToolbar`, the `MeaningCard` wiring + state from `ReaderScreen`,
   the About-screen dictionary status/attribution rows from
   `SettingsScreen`, and the `.folio-meaning*` CSS block.
2. **Remove the dependency and bundling surface.** `Cargo.toml` drops
   `rusqlite`; `Cargo.lock` regenerated; `tauri.conf.json` no longer bundles
   `dict/*` as resources; `lib.rs` loses the `dict_*` commands and the
   first-run `ensure_installed` copy step.
3. **Keep the selection toolbar and About sections stripped, not redesigned:**
   highlight swatches, Add note, Copy remain; About keeps Version.
4. **Unrelated hashing is untouched** — `sha2`/`sha256_file` remain for
   content hashes and backup verification.
5. **Regression guard:** `desktop/tests/noDictionary.test.ts` fails if any
   dictionary marker reappears in app source.

## Alternatives rejected

- **Unblock FT-004 by rebuilding the pack here.** The FreeDict source, the
  build script and the mobile tree are all outside this repo; no data source
  exists to build the asset from.
- **Keep the code dormant behind a flag.** Preserved dead Rust commands,
  bundled-SQLite linking and confusing disabled UI for a feature with no
  possible activation.

## Consequences

- Users who installed an earlier build keep an orphaned `%APPDATA%/Folio/dict/`
  copy (~5 MB); nothing reads or writes it — it can be deleted manually.
- Settings → About shows only Version; the GPL-2.0 attribution line applies
  to nothing shipped and is removed with the feature.
- Test count is unchanged for dictionary suites (none existed); the new
  source-scan guard adds 2 cases.
