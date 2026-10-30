# I-20261030-02 — Reader locator correctness (FT-008)

**Date:** 2026-10-30
**Task:** FT-008 (audit Phase 2)
**Decision base:** user confirmed Phase 2 locator format = `href + progression + text anchor`; no CFI (the installed `@readium/navigator` / `@readium/shared` expose none)
**Status:** done (Linux verification green; Windows/webview behaviour unverified)

## Scope

Open and restore reading positions precisely, land annotations/bookmarks
reliably, and stop the reader from fighting interactive content.

## Core design: persisted locator codec

`desktop/src/reader/locatorCodec.ts` (new) encodes schema-1 locator strings the
engine can resolve exactly:

```
ch1.xhtml?p=0.4286&q=Call%20me&b=pre&a=post#note1
```

- `href` — the spine resource (stable across re-imports).
- `p` — 0..1 progression inside the resource; absent when ≤ 0.
- `q`/`b`/`a` — text quote + prefix/suffix, resolved by Readium's
  TextQuoteAnchor (`rangeFromLocator`), the same mechanism that finds
  highlight ranges.
- `#fragment` — element id.
- Unknown query parameters stay part of the href, so plain mobile fallbacks
  (`ch1.xhtml`, `ch1.xhtml#frag`, `ch1.xhtml?v=2`) still decode.
- `epubcfi(...)` values are rejected by `decodeLocation` so the resume cascade
  falls back to the saved percent (this build has no CFI API — verified against
  the installed `@readium` packages' dist output).

Schema-1 compatibility is untouched: no field renamed or removed, unknown keys
preserved; only the *content style* of `Progress.location` /
`Annotation.location` is extended.

## Files touched

| File | Change |
|---|---|
| `desktop/src/reader/locatorCodec.ts` | **new** — `encodeLocation`, `decodeLocation`, `hrefOf`, `anchorOf`, `sameLocation`, `withAnchor`, `isCfiLocation` |
| `desktop/src/reader/resume.ts` | new `saved-locator` plan kind (saved href locators are no longer discarded in favour of coarse percent); `anchoredLocator` merges the override anchor into a single navigation instead of a two-step `goAnchored` |
| `desktop/src/reader/readiumEngine.ts` | `locatorFromString` rebuilds a full locator (progression + fragments + text anchor); `locatorToString` persists progression + anchor; editor hrefs compared percent-decoded (`decodeHref`); unresolvable highlight decorations are skipped rather than painted at chapter start; CFI checks via `isCfiLocation` |
| `desktop/src/reader/chrome.ts` | **new export** `intentForReaderClick` — interactive/prevented clicks pass through to the engine; others resolve by thirds zones (pure, unit-tested) |
| `desktop/src/screens/ReaderScreen.tsx` | click handler honours `interactive`/`defaultPrevented`; teardown always unsubscribes engine listeners (the old `disposedRef` guard leaked them when `handleBack` ran first); `handleBack` only flushes + navigates (destroy left to the idempotent effect cleanup); prefs effect keys on `doc?.docId` so page turns no longer trigger redundant `applyPrefs` relayouts; keyboard matrix: `M` toggles chrome, `Ctrl/Cmd+F` toggles in-book search, `Escape` closes panel → search → selection; bookmark dedupe via `sameLocation`; search-hit and highlight helpers use `hrefOf` |
| `desktop/tests/locatorCodec.test.ts` | **new** — encode/decode round-trips, CFI/foreign-query/fallback handling, `withAnchor`, `sameLocation` epsilon |
| `desktop/tests/reader.test.ts` | resume cascade `saved-locator` cases; `intentForReaderClick` passthrough cases |

## Known deferrals

- **Resize/rotation relayout** stays with `EpubNavigator`'s internal
  `ResizeObserver`; cannot be observed or verified on this Linux host.
- **Resume of mobile CFIs** remains percent-based by necessity (no CFI APIs in
  the installed packages); legacy `epubcfi(...)` strings are detected and fall
  back rather than being applied.

## Verification

Run on this Linux host, `desktop/` working directory (2026-10-30):

```
./node_modules/.bin/tsc -b                 # clean
./node_modules/.bin/vitest run             # 143 tests / 13 files passing
./node_modules/.bin/vite build             # success (existing >500 kB chunk warning)
cd src-tauri && cargo fmt --all -- --check # clean
```

`cargo test`, `pnpm tauri:dev` and real Windows/webview reading behaviour were
**not** run or verified here — this host lacks `webkit2gtk`/`gtk3`, and the
full Tauri build is Windows-first. Do not describe those as verified.
