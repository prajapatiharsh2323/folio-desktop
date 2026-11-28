# OpenCode prompt — visual verification pass

For each fixed viewport and theme, capture consistent screenshots of:
1. Library: loading, populated, empty, error, search/filter, context menu.
2. Collections: gallery, detail, create/rename/delete dialogs, picker.
3. Notes: list, filters, search, edit/delete/export.
4. Insights: loading, no-data, populated, goal.
5. Settings: each section, dialogs, keyboard shortcuts.
6. Reader EPUB: clean canvas, chrome visible/hidden, TOC, search, appearance, selection, annotation, footnote, dock.
7. Reader PDF: fit modes, zoomed/panned, thumbnails, selection/annotation.

Compare against shared tokens and component contracts. Check clipping, overlap, overflow, alignment, contrast, text truncation, scroll ownership, focus ring and control state. Use screenshots from the same app build, window size, OS scale and theme. Do not fabricate a visual regression result if screenshots cannot be captured. Report each mismatch with screenshot path and smallest correction.
