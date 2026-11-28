# Initial risk register — validate, do not assume

All entries below are **unverified audit hypotheses** inferred from the architecture and exposed code interfaces. Promote them to confirmed issues only with reproducible evidence.

| ID | Area | Hypothesis to test | Why it matters | Priority |
|---|---|---|---|---|
| RISK-01 | Reader lifecycle | Async open/progress/navigation callbacks may outlive a route or engine instance | Stale state, duplicate updates, stuck splash, memory leaks | P1 |
| RISK-02 | EPUB/PDF parity | Shared reader controls may expose settings/actions unsupported by one format | Confusing controls or no-op behavior | P1 |
| RISK-03 | Resume/progress | Locator, percentage, page index, chapter marks, and saved progress may diverge | Users reopen at the wrong place | P1 |
| RISK-04 | Selection/gestures | Edge page-turn, text selection, context menu, touch/pointer and chrome reveal may conflict | Accidental navigation or lost selection | P1 |
| RISK-05 | Overlay coordination | Dialogs, popovers, menus, command palette and reader panels may compete for Escape/focus/z-index | Trapped focus or multiple layers closing | P1 |
| RISK-06 | Preferences | Global defaults, per-book overrides, OS theme and publisher colors may conflict | Unstable or surprising reading appearance | P2 |
| RISK-07 | Persistence | Concurrent writes, app shutdown, backup/restore and reindex may race | Corruption or lost progress/annotations | P0/P1 |
| RISK-08 | Import pipeline | File, folder, drag/drop and open-with paths may differ in validation/cleanup | Import failures, duplicates, unsafe archives | P1 |
| RISK-09 | Search | Worker/index/cache may become stale after import, delete, restore, or metadata change | Missing or stale search results | P2 |
| RISK-10 | UI consistency | Shared primitives may be bypassed by screen-specific markup/styles | Inconsistent controls, spacing, focus and empty states | P2 |
| RISK-11 | Reading typography | Width, line height, paragraph spacing, font scaling and zoom may overflow or become unreadable | Reading fatigue and broken layouts | P2 |
| RISK-12 | Accessibility | Keyboard/focus/ARIA behavior may differ across custom controls and overlays | Inaccessible core workflows | P1 |
| RISK-13 | Window behavior | Resize, maximize, display scaling, fullscreen and UI zoom may break layout | Clipping and inaccessible controls | P2 |
| RISK-14 | Error states | Caught errors may be hidden, vague, or leave controls in busy state | User cannot recover or diagnose | P2 |
| RISK-15 | Performance | Large libraries/books may cause expensive rerenders, indexing stalls or memory pressure | Slow startup and reading | P2 |

## Required validation
For each hypothesis, inspect implementation, identify relevant tests, run the app, reproduce with representative fixtures, and record evidence in `reports/ISSUE-REGISTER.md`. A hypothesis may be closed as “not observed” with the test conditions documented.
