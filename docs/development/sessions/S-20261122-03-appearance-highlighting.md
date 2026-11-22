# S-20261122-03 — Appearance polish, complete-range EPUB highlights, dark-mode audit

**Session:** 2026-11-22, main checkout (no worktree)
**Plan:** user brief "Folio Desktop — Appearance UI, EPUB Dark Mode & Highlighting Implementation Plan"; scope narrowed after code review to the **revised plan** (fix the provable highlighter bug, scoped panel redesign, dark mode only where reproduced).
**Status:** code complete, all Linux gates green; Windows/WebView2 visual QA still required.

## Findings from the pre-implementation audit

The brief described work already shipped in `96f2803` (FT-058/059): separate
EPUB/PDF panels and prefs, dark/true-black palettes, link/visited/selection
colours, additive Publisher presentation, Readium decoration style/tint fix,
theme-aware highlight palette. Two of the three reported bugs were real and had
narrow root causes; the dark-mode premise was stale.

### Root cause — incomplete EPUB highlights

Readium sends the full selected text (`navigator-html-injectables`
`Peripherals.onPointUp`: `text: selection.toString()`), but Folio's locator
codec capped **every** quote at `MAX_ANCHOR_CHARS = 200`. Since Readium resolves
decorations with `TextQuoteAnchor(root, text.highlight).toRange()`, the painted
range covered only the first ~200 characters — typically one visual line of a
paragraph. This was latent in `locatorCodec.ts`, `decorations.ts`,
`useAnnotations.ts` and `ReadiumEngine.locatorFromString()`.

### Root cause — theme swatch grid

`.folio-theme-grid` was `repeat(5, 1fr)` (`src/styles/reader.css`) while the
EPUB panel offers six options (Publisher + five themes), orphaning "System" on
a second row. The same class is used by the PDF panel and onboarding, so the
fix was scoped to `.folio-appearance`.

### Dark mode — no code change

`resolveReaderTheme()` and `toNavigatorPreferences()` already pass resolved
background/text/link/visited/selection colours, and the installed ReadiumCSS
`after` sheet forces them with `!important` over author CSS
(`:root[style*="--USER__textColor"] *:not(a)`, link/visited/::selection, and
`svg text { fill: currentcolor }`). Publisher mode deliberately clears user
colours via `null`; `EpubPreferences.merging()` copies null (clears overrides),
so switching back re-applies Folio's palette. Added a UI explanation of
Publisher mode and an engine test for the round trip. Real WebView2 QA against
styled EPUBs (inline `!important`, tables, SVG) remains the open verification.

## Changes

- `src/reader/locatorCodec.ts` — `MAX_DECORATION_ANCHOR_CHARS = 4000`; optional
  cap threaded through `clip`, `encodeLocation`, `decodeLocation`, `withAnchor`.
  Progress anchors keep the 200-char cap.
- `src/screens/reader/decorations.ts`, `src/screens/reader/useAnnotations.ts` —
  annotation/decoration anchors use the full-quote cap.
- `src/reader/readiumEngine.ts` — `locatorFromString(value, maxAnchorChars?)`
  and `applyDecorations()` decode with the decoration cap.
- `src/components/appearancePrimitives.tsx` (new) — `AppearanceSection`,
  `AppearanceSwitchRow`, `AppearancePanelFooter`.
- `src/components/AppearancePanel.tsx` — sections: Reading theme (3-column
  grid + Publisher explanation), Quick adjustments (font size + width presets
  only), Typography preview (now shows selection colour), Typography (typeface,
  line spacing, alignment/hyphenation switches), Advanced spacing (collapsible
  margins/width/paragraph/letter spacing), Page layout, Brightness, sticky reset
  footer. Removed the duplicate font-size slider, alignment/hyphenation quick
  chips and full-width chip.
- `src/components/PdfAppearancePanel.tsx` — sections: Appearance, Zoom &
  navigation, Page layout, Page adjustments, Workspace; switches now have
  label/description on the left of the control; sticky reset footer.
- `src/styles/reader.css` — scoped 3-column theme grid, section/switch-row/
  advanced/footer styling and scroll reservation.
- Tests: new `tests/epubDecorationRange.test.ts` (multi-line quote survives
  annotation → decoration → `applyDecorations()`), expanded
  `locatorCodec.test.ts`, `appearancePanel.test.tsx` (single control per pref,
  collapsible advanced section, sticky footer, Publisher explanation) and
  `reader.test.ts` (Publisher → Folio colour round trip).

## Gates (Linux host, 2026-11-22)

`tsc -b` clean; ESLint 0/0; Prettier clean; **Vitest 776/776 (99 files)**;
`vite build` green. Python/Rust gates unchanged (no Rust code touched).

## Remaining / exact next action

Windows/WebView2 manual QA: a styled EPUB with a paragraph selection spanning
multiple visual lines and inline markup (verify every line paints, repaint after
font/resize/theme change, no stale highlight after reopening); dark/true-black
with author inline colours, tables, lists, SVG and images; both redesigned
panels at narrow widths; PDF controls regression. No commits or pushes were made.
