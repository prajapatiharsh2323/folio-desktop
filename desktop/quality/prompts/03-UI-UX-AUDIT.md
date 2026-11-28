# OpenCode prompt — UI/UX and reading experience audit

Audit all screens and reader surfaces without changing code initially.

Evaluate:
- visual hierarchy and consistent page headers;
- typography scale, line height, font weight, paragraph rhythm and readable line length;
- spacing, alignment, component heights, icon size, borders, radii, elevation and focus rings;
- shared component reuse vs one-off implementations;
- interaction states: hover, pressed, selected, disabled, loading, error, success and destructive;
- empty/loading/error states and recovery actions;
- overlays, menus, popovers, dialogs, panel stacking, Escape and focus return;
- scrolling, sticky areas, clipping, overflow, scrollbar styling and nested scroll regions;
- window resize, small window, display scaling, UI zoom, light/dark/high contrast;
- keyboard-only access, semantic labels, focus visibility and reduced motion;
- reading canvas comfort: content width, margins, font controls, page/scroll modes, distraction and toolbar occlusion.

Inspect `tokens.css`, `base.css`, `components.css`, `reader.css`, `pdf.css`, theme resolution and every screen. Produce a token/component consistency map and screenshot inventory. For each mismatch, give evidence, user impact and a proposed shared-system fix. Do not redesign by taste or replace the product's visual identity. Keep the reading surface calm and prioritize legibility over decoration.
