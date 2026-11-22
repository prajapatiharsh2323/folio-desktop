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

/** Apply a PDF /Rotate-style quarter turn to a page box (points). */
export function rotateSize(page: PageSize, rotation: number): PageSize {
  return rotation === 90 || rotation === 270
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
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
  options: {
    gap?: number;
    padding?: number;
    coverFirst?: boolean;
    direction?: "ltr" | "rtl";
  } = {},
): PageLayout {
  const gap = options.gap ?? PAGE_GAP;
  const padding = options.padding ?? LAYOUT_PADDING;
  const coverFirst = options.coverFirst ?? true;
  const direction = options.direction ?? "ltr";
  const placements: PagePlacement[] = [];
  if (pageSizes.length === 0) {
    return { placements, totalHeight: 0, totalWidth: 0, spread, gap, scale: 1 };
  }

  const rows: number[][] = [];
  if (spread === "both") {
    let p = 1;
    if (coverFirst && p <= pageSizes.length) rows.push([p++]);
    for (; p <= pageSizes.length; p += 2) {
      rows.push(p + 1 <= pageSizes.length ? [p, p + 1] : [p]);
    }
  } else {
    for (let p = 1; p <= pageSizes.length; p++) rows.push([p]);
  }
  // Right-to-left reading mirrors each row's visual page order while keeping
  // placements keyed by their physical page number.
  const orderedRows = direction === "rtl" ? rows.map((row) => [...row].reverse()) : rows;

  const contentWidth = Math.max(1, viewport.width - padding * 2);
  const sizes = new Map<number, { width: number; height: number }>();

  // Every page shares one scale so a spread's two pages align and the column
  // never reflows mid-document. In spread mode the fitting reference is the
  // *widest row* (both pages plus the gutter), not a single page — otherwise
  // "fit width" makes facing pages twice the viewport and forces horizontal
  // overflow. Fit-page uses the tallest page, so mixed-size documents never
  // push a later tall page out of view.
  const rowPoints = (row: number[]) => row.reduce((sum, p) => sum + pageSizes[p - 1].width, 0);
  const referenceWidth = rows.length > 0 ? Math.max(...rows.map(rowPoints)) : 1;
  const referenceHeight = pageSizes.reduce((max, s) => Math.max(max, s.height), 1);
  // The gutter is already in CSS px, not scaled points: subtract it from the
  // available width before resolving the scale so a fitted row really fits.
  const maxColumns = rows.length > 0 ? Math.max(...rows.map((row) => row.length)) : 1;
  const fittingViewport = {
    width: Math.max(1, viewport.width - gap * (maxColumns - 1)),
    height: viewport.height,
  };
  const baseScale = resolveScale(
    zoom,
    { width: referenceWidth, height: referenceHeight },
    fittingViewport,
    padding,
  );
  for (let i = 0; i < pageSizes.length; i++) {
    sizes.set(i + 1, displaySize(pageSizes[i], baseScale));
  }

  let top = padding;
  let totalWidth = 0;
  for (let rowIndex = 0; rowIndex < orderedRows.length; rowIndex++) {
    const row = orderedRows[rowIndex];
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
    top += rowHeight + (rowIndex === orderedRows.length - 1 ? 0 : gap);
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
  // Placements follow *visual* order (RTL rows are mirrored), so never assume
  // array index equals page number.
  return placements.find((placement) => placement.page === page) ?? null;
}

/**
 * Pages sharing a vertical row (a facing-page spread). Rows are ordered
 * top-to-bottom, pages left-to-right. Row-aware navigation and offset lookup
 * use this so a two-page spread is one deterministic step, not an ambiguous
 * choice between two placements with the same top.
 */
export function spreadRows(placements: PagePlacement[]): number[][] {
  const byTop = new Map<number, number[]>();
  for (const p of placements) {
    const key = Math.round(p.top * 100) / 100;
    const row = byTop.get(key) ?? [];
    row.push(p.page);
    byTop.set(key, row);
  }
  return [...byTop.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, pages]) => pages.sort((a, b) => a - b));
}

/** First page of the spread row one step forward/backward from `page`. */
export function nextRowPage(placements: PagePlacement[], page: number, direction: 1 | -1): number {
  const rows = spreadRows(placements);
  const index = rows.findIndex((row) => row.includes(page));
  if (index < 0) return Math.min(placements.length, Math.max(1, page + direction));
  const target = rows[Math.min(rows.length - 1, Math.max(0, index + direction))];
  // Physical reading-order start, independent of the row's visual mirroring.
  return Math.min(...target);
}

/** 1-based row-start page whose vertical span contains a content-space offset. */
export function pageAtOffset(placements: PagePlacement[], offsetY: number): number {
  if (placements.length === 0) return 1;
  const rows = spreadRows(placements);
  let nearestRow = rows[0];
  let nearestDistance = Infinity;
  const rowStart = (row: number[]) => Math.min(...row);
  for (const row of rows) {
    const boxes = row
      .map((p) => placementFor(placements, p))
      .filter((p): p is PagePlacement => !!p);
    if (boxes.length === 0) continue;
    const top = Math.min(...boxes.map((p) => p.top));
    const bottom = Math.max(...boxes.map((p) => p.top + p.height));
    if (offsetY >= top && offsetY <= bottom) return Math.min(...row);
    // `offsetForPage` deliberately top-aligns a page LAYOUT_PADDING above its
    // box, so a small gap above a row still belongs to that row.
    const distance = offsetY < top ? Math.max(0, top - offsetY - LAYOUT_PADDING) : offsetY - bottom;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestRow = row;
    }
  }
  return rowStart(nearestRow);
}

/** Scroll-top that preserves the reading fraction inside the current page. */
export function offsetForPageFraction(
  placements: PagePlacement[],
  page: number,
  fraction: number,
  viewport: ViewportSize,
  totalHeight: number,
): number {
  const p = placementFor(placements, page);
  if (!p) return 0;
  const top = p.top + p.height * Math.min(1, Math.max(0, fraction)) - LAYOUT_PADDING;
  return Math.min(Math.max(0, top), Math.max(0, totalHeight - viewport.height));
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
