// PDF layout math (PDF plan §7.1). Pure functions — no DOM, no pdf.js — so
// the fixed-layout geometry is unit-testable and the engine stays glue.
//
// Coordinates: PDF pages are in points (72/inch); the display scale converts
// them to CSS px (zoom 1 = 96/72 px/pt, i.e. a 612 pt letter page is 816 CSS
// px wide at 100 %). Placements are in content-space CSS px; the scroll
// container owns the offsets.

export interface PageSize {
  /** unrotated page box in points (from pdf.js viewport at scale 1) */
  width: number;
  height: number;
}

export interface ViewportSize {
  /** scroll container client size in CSS px */
  width: number;
  height: number;
}

export type ZoomMode = "fit-width" | "fit-page" | number;

export interface PagePlacement {
  /** 1-based page */
  page: number;
  /** content-space CSS px of the page's top-left corner */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PageLayout {
  placements: PagePlacement[];
  /** total content height in CSS px (scroll extent) */
  totalHeight: number;
  /** widest single page in the layout (scroll extent in spread columns) */
  totalWidth: number;
  /** the spread actually laid out (after "auto" resolution) */
  spread: SpreadMode;
  gap: number;
  /** CSS px per point used for every page in this layout */
  scale: number;
}

export type SpreadMode = "none" | "both";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.2;
/** zoom 1 renders 1 pt as 96/72 CSS px (96 dpi reading size). */
export const BASE_SCALE = 96 / 72;
/** Vertical gap between pages / horizontal gap in a spread, CSS px. */
export const PAGE_GAP = 16;
/** Viewport padding around the page column, CSS px. */
export const LAYOUT_PADDING = 12;

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** The scale a zoom mode resolves to for one page in a viewport (CSS px/pt). */
export function resolveScale(
  zoom: ZoomMode,
  page: PageSize,
  viewport: ViewportSize,
  padding: number = LAYOUT_PADDING,
): number {
  if (typeof zoom === "number") return clampZoom(zoom) * BASE_SCALE;
  const availW = Math.max(1, viewport.width - padding * 2);
  const availH = Math.max(1, viewport.height - padding * 2);
  if (zoom === "fit-width") {
    return clampZoom(availW / Math.max(1, page.width));
  }
  // fit-page: whole page visible in both axes
  return clampZoom(Math.min(availW / Math.max(1, page.width), availH / Math.max(1, page.height)));
}

export function displaySize(page: PageSize, scale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(page.width * scale)),
    height: Math.max(1, Math.round(page.height * scale)),
  };
}

/** Resolve the "auto" spread preference against the viewport (plan D3-era
 *  UI spec): spreads only when the window is landscape. */
export function effectiveSpread(
  pref: "none" | "auto" | "both",
  viewport: ViewportSize,
): SpreadMode {
  if (pref === "none") return "none";
  if (pref === "both") return "both";
  return viewport.width > viewport.height ? "both" : "none";
}

/**
 * Lay out every page top-to-bottom. Single mode: one centered column.
 * Spread mode: page 1 (cover) alone, then pairs (2,3), (4,5), … — the book
 * convention, so a spread turn never splits a two-page opening. Pages whose
 * sizes differ lay out at their own size; a row's height is the taller page.
 */
export function layoutPages(
  pageSizes: PageSize[],
  viewport: ViewportSize,
  zoom: ZoomMode,
  spread: SpreadMode,
  options: { gap?: number; padding?: number } = {},
): PageLayout {
  const gap = options.gap ?? PAGE_GAP;
  const padding = options.padding ?? LAYOUT_PADDING;
  const placements: PagePlacement[] = [];
  if (pageSizes.length === 0) {
    return { placements, totalHeight: 0, totalWidth: 0, spread, gap, scale: 1 };
  }

  const rows: number[][] = [];
  if (spread === "both") {
    rows.push([1]);
    for (let p = 2; p <= pageSizes.length; p += 2) {
      rows.push(p + 1 <= pageSizes.length ? [p, p + 1] : [p]);
    }
  } else {
    for (let p = 1; p <= pageSizes.length; p++) rows.push([p]);
  }

  const contentWidth = Math.max(1, viewport.width - padding * 2);
  const sizes = new Map<number, { width: number; height: number }>();

  // Column width: every page scales against the same reference so a spread's
  // two pages share one scale and the column never reflows mid-document.
  const reference = pageSizes.reduce((max, s) => Math.max(max, s.width), 1);
  const baseScale = resolveScale(
    zoom,
    { width: reference, height: pageSizes[0].height },
    viewport,
    padding,
  );
  for (let i = 0; i < pageSizes.length; i++) {
    sizes.set(i + 1, displaySize(pageSizes[i], baseScale));
  }

  let top = padding;
  let totalWidth = 0;
  for (const row of rows) {
    const rowSizes = row.map((p) => sizes.get(p)!);
    const rowHeight = Math.max(...rowSizes.map((s) => s.height));
    const rowWidth = rowSizes.reduce((sum, s) => sum + s.width, 0) + gap * (row.length - 1);
    totalWidth = Math.max(totalWidth, rowWidth);
    // Center the row horizontally.
    let left = padding + Math.max(0, (contentWidth - rowWidth) / 2);
    for (const p of row) {
      const size = sizes.get(p)!;
      // Vertically center shorter pages within their row.
      placements.push({
        page: p,
        left,
        top: top + (rowHeight - size.height) / 2,
        width: size.width,
        height: size.height,
      });
      left += size.width + gap;
    }
    top += rowHeight + (row === rows[rows.length - 1] ? 0 : gap);
  }

  return {
    placements,
    totalHeight: top + padding,
    totalWidth: totalWidth + padding * 2,
    spread,
    gap,
    scale: baseScale,
  };
}

function placementFor(placements: PagePlacement[], page: number): PagePlacement | null {
  if (page < 1 || page > placements.length) return null;
  return placements[page - 1].page === page ? placements[page - 1] : null;
}

/** 1-based page whose vertical span contains a content-space offset. */
export function pageAtOffset(placements: PagePlacement[], offsetY: number): number {
  if (placements.length === 0) return 1;
  // Binary search: placements are sorted by top.
  let lo = 0;
  let hi = placements.length - 1;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = placements[mid];
    if (offsetY < p.top) {
      hi = mid - 1;
    } else if (offsetY > p.top + p.height) {
      best = mid + 1 < placements.length ? placements[mid + 1].page : p.page;
      lo = mid + 1;
    } else {
      return p.page;
    }
  }
  return Math.min(placements.length, Math.max(1, best));
}

/** Scroll-top that brings a page into view, top-aligned with the layout
 *  padding (plan §7): centering would cut off the page top when the page
 *  fits the viewport; a page taller than the viewport keeps its top visible
 *  and the reader scrolls on from there. */
export function offsetForPage(
  placements: PagePlacement[],
  page: number,
  viewport: ViewportSize,
  totalHeight: number,
): number {
  const p = placementFor(placements, page);
  if (!p) return 0;
  const top = Math.max(0, p.top - LAYOUT_PADDING);
  return Math.min(Math.max(0, top), Math.max(0, totalHeight - viewport.height));
}

/** Center-based progression so a scrub maps to the nearest page (50 % = the
 *  middle page of an odd-count book). */
export function progressionForPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return (page - 0.5) / pageCount;
}

export function pageForProgression(progression: number, pageCount: number): number {
  if (pageCount <= 0) return 1;
  const clamped = Math.min(1, Math.max(0, progression));
  const page = Math.round(clamped * pageCount + 0.5 - 0.000001);
  return Math.min(pageCount, Math.max(1, page));
}

/** Absolute zoom for zoomBy (plan §7.3): resolve fit modes against the
 *  current page first, then step geometrically and clamp. */
export function stepZoom(
  current: ZoomMode,
  direction: 1 | -1,
  page: PageSize,
  viewport: ViewportSize,
): number {
  const base =
    typeof current === "number" ? current : resolveScale(current, page, viewport) / BASE_SCALE;
  const stepped = clampZoom(base * (direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP));
  // Snap near the fit-width scale so zoom-out collapses back into the mode.
  const fitWidth = resolveScale("fit-width", page, viewport) / BASE_SCALE;
  if (direction === -1 && stepped <= fitWidth * 1.05) return fitWidth;
  return stepped;
}

/** "page-N" ↔ N (plan §5: PDF chapter hrefs and progress locations share this
 *  form; anything else is not a PDF page locator). */
export function pageFromHref(href: string | null | undefined): number | null {
  const match = /^page-(\d+)$/.exec((href ?? "").split("#")[0]);
  return match ? Number(match[1]) : null;
}

export function hrefForPage(page: number): string {
  return `page-${page}`;
}
