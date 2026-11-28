# OpenCode prompt — reader specialist regression audit

Act as a specialist in desktop EPUB and PDF reader engineering.

Trace and test these state machines separately:
- engine creation/open/progress/ready/error/destroy;
- route origin and close/back behavior;
- locator/progression/page index/resume persistence;
- chrome visibility/focus mode/line focus;
- text selection vs page-turn gestures;
- annotations/decorations and popover activation;
- footnote and internal/external link navigation;
- in-book search and result navigation;
- appearance preference resolution and OS theme changes;
- PDF zoom/fit/pan/thumbnail/page layout;
- dock scrub preview/commit and chapter marks;
- keyboard shortcut routing and input guards.

Use synthetic fixtures and a disposable profile. Stress rapid open/close, switch during load, unmount during async work, repeated event registration, app restart, missing metadata, long/complex books, large PDFs and window resizing. Identify exact expected vs actual behavior and create regression tests. Never modify user books or silently rewrite progress.
