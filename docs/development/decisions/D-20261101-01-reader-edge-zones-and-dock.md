# D-20261101-01 — Reader click zones are narrow edges; one serialized navigation path; dock + hairline chrome

**Status:** adopted 2026-11-01
**Affects:** `.docs/03-ui-ux-spec.md` §5.3, `.docs/04-reader-spec.md` §5, `.docs/07-keyboard-and-input.md` §2–§3, `desktop/src/reader/chrome.ts`, `desktop/src/reader/navigation.ts`, `desktop/src/reader/readiumEngine.ts`, `desktop/src/components/ReaderChrome.tsx`, `desktop/src/components/ReaderDock.tsx`, `desktop/src/screens/ReaderScreen.tsx`, `desktop/src/styles/reader.css`, `desktop/tests/`

## Context

The reader inherited a mobile tap-zone model: left third = back, middle third =
toggle chrome, right third = forward. On a desktop with a mouse and a selection
toolbar, the middle third is where people click to place a caret, dismiss a
selection, or follow a footnote. Turning that click into a chrome toggle makes
the toolbar appear and disappear mid-read and competes with text selection.
Spec `.docs/04` §5 also promised hover chevrons at the edges, but the Readium
content iframe does not forward hover events to the host, so they could never be
shown reliably.

At the same time the reader had three coordination gaps:

1. `ReaderNavigationCoordinator` used sequence ids and a refcounted seek gate but
   did not serialize engine calls. Two rapid jumps could land out of order.
2. The chrome only exempted the More menu from auto-hide. An open panel, an
   in-book search, a text selection or keyboard focus could be hidden out from
   under the user after 3 s.
3. Contents and Bookmark were buried inside the More menu, and the back label was
   hard-coded "Back to library" even when the reader was opened from Collections,
   Notes or Settings.

Navigation sources (page-edge clicks, Previous/Next, keyboard, TOC, in-book
search, slider, bookmark/annotation jumps) also had no single queue, so a
destination could be overwritten by an in-flight page turn.

## Decision

1. **Click zones are narrow edge bands.** Back/forward occupy 8% of the reading
   surface on each side, clamped to 48–96 CSS px. Everything between them passes
   through to the publication untouched. Interactive elements (links, footnotes,
   media) stay engine-owned. A click while a selection is live is ignored so a
   drag-highlight can never flip the page. Blank surface outside the publication
   reveals the chrome instead of navigating. Clicking text never toggles the
   chrome.
2. **One serialized navigation path.** Every chrome-driven move goes through
   `ReaderNavigationCoordinator`: at most one engine call in flight, one pending
   absolute-destination slot (last write wins), FIFO page turns that keep their
   order across a destination, a seek gate that settles in `finally`, and
   `{ ok, superseded, reason }` outcomes. Superseded completions are never
   reported as failures; the newest failure is surfaced once.
3. **Chrome = top bar + bottom dock, with holds.** The top bar exposes Contents,
   Search, Bookmark (pressed when bookmarked), Appearance and More. The dock holds
   Previous/Next around `chapter · percent · time-left`, with the scrubber
   underneath. Chrome hides after 3 s idle but is held open by an open menu,
   panel, dialog, in-book search, selection, scrub, keyboard focus or pointer
   rest. Hidden chrome becomes `inert`; only a 3 px progress hairline and its
   percent remain. Pointer movement anywhere over the page reveals the chrome
   again (frame-level `pointermove`).
4. **No page numbers.** Positions are synthetic 1024-byte chunks, not rendered
   pages; the UI shows percent and time-left only.

## Alternatives considered

- **Keep the thirds model.** Rejected: it puts a state-changing action under the
  most common text click and conflicts with selection and link handling.
- **Full-width bottom pill.** Rejected: less discoverable than a dock with
  explicit Previous/Next, and it covers the publication's bottom line edge to
  edge.
- **Hover chevrons over the canvas.** Rejected: the content iframe swallows
  pointer events, so hover cannot be detected reliably; a permanent decoration
  would imply a control that is not clickable.
- **Allow overlapping engine navigation.** Rejected: Readium's calls are async
  and land by completion, not by issue order; overlapping jumps can end at the
  wrong position.
- **Synthetic page counts.** Rejected: meaningless and misleading for reflowable
  EPUB.

## Consequences

- `.docs/03` §5.3, `.docs/04` §5 and `.docs/07` §2–§3 were updated in the same
  change; mobile tap-zone parity is superseded for desktop by this record.
- `tests/navigation.test.ts` was rewritten around the serialized queue (17
  cases); `tests/readerChrome.test.tsx` and the chrome section of
  `tests/reader.test.ts` pin the dock, holds, hairline and edge geometry.
- Panels and in-book search keep the app palette; the canvas keeps the reading
  theme (two-colour-system invariant unchanged).
- Focus mode, session info and the shortcut guide remain session-only and add no
  `ReadingPrefs` / `Progress` / `Annotation` fields.
- Internal EPUB link/anchor handling remains engine-owned (not funnelled through
  the coordinator); only chrome-driven navigation is serialized.
- Bookmarks are written through the existing `AnnotationsRepo`; no new store and
  no schema change.
- Runtime verification of iframe hover, selection drag, paginated/scrolled
  layouts and resize still requires a human on Windows; Linux/CI verification is
  limited to `tsc`, Vitest and the Vite build.
