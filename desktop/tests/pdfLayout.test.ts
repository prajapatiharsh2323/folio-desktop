// Pure layout math for the PDF engine (PDF plan §7.1). No DOM, no pdf.js.
import { describe, expect, it } from "vitest";
import {
  BASE_SCALE,
  LAYOUT_PADDING,
  MAX_ZOOM,
  MIN_ZOOM,
  PAGE_GAP,
  clampZoom,
  displaySize,
  effectiveSpread,
  hrefForPage,
  layoutPages,
  offsetForPage,
  pageAtOffset,
  pageForProgression,
  pageFromHref,
  progressionForPage,
  resolveScale,
  stepZoom,
  type PageSize,
} from "../src/pdf/pdfLayout";

const LETTER: PageSize = { width: 612, height: 792 };
const VIEW: { width: number; height: number } = { width: 840, height: 900 };

describe("pdfLayout · zoom", () => {
  it("clamps to the supported range", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("resolves fit-width against the page width", () => {
    const scale = resolveScale("fit-width", LETTER, VIEW);
    // (840 - 24) / 612 CSS px per pt
    expect(scale).toBeCloseTo((VIEW.width - LAYOUT_PADDING * 2) / LETTER.width, 5);
  });

  it("resolves fit-page to the min axis", () => {
    const scale = resolveScale("fit-page", LETTER, VIEW);
    expect(scale).toBeCloseTo(
      Math.min((VIEW.width - 24) / LETTER.width, (VIEW.height - 24) / LETTER.height),
      5,
    );
  });

  it("treats an absolute zoom of 1 as 96/72 px/pt", () => {
    expect(resolveScale(1, LETTER, VIEW)).toBeCloseTo(BASE_SCALE, 5);
    expect(displaySize(LETTER, resolveScale(1, LETTER, VIEW)).width).toBe(816);
  });

  it("steps zoom geometrically and snaps back to fit-width", () => {
    const stepped = stepZoom(1, 1, LETTER, VIEW);
    expect(stepped).toBeGreaterThan(1);
    expect(stepZoom(stepped, -1, LETTER, VIEW)).toBeCloseTo(1, 5);
    // zooming out below fit-width collapses into the fit-width scale
    const fitWidth = resolveScale("fit-width", LETTER, VIEW) / BASE_SCALE;
    expect(stepZoom(fitWidth * 0.9, -1, LETTER, VIEW)).toBeCloseTo(fitWidth, 5);
  });
});

describe("pdfLayout · spread", () => {
  it("resolves auto by viewport aspect", () => {
    expect(effectiveSpread("auto", { width: 1200, height: 700 })).toBe("both");
    expect(effectiveSpread("auto", { width: 700, height: 1200 })).toBe("none");
    expect(effectiveSpread("none", { width: 1200, height: 700 })).toBe("none");
    expect(effectiveSpread("both", { width: 700, height: 1200 })).toBe("both");
  });
});

describe("pdfLayout · layoutPages", () => {
  const sizes = (n: number, size: PageSize = LETTER): PageSize[] =>
    Array.from({ length: n }, () => size);

  it("stacks a single centered column", () => {
    const layout = layoutPages(sizes(3), VIEW, "fit-width", "none");
    expect(layout.placements).toHaveLength(3);
    const [first, second] = layout.placements;
    expect(first.page).toBe(1);
    expect(first.top).toBe(LAYOUT_PADDING);
    expect(second.top).toBe(LAYOUT_PADDING + first.height + PAGE_GAP);
    // centered horizontally
    expect(first.left).toBeCloseTo(LAYOUT_PADDING + (VIEW.width - 24 - first.width) / 2, 5);
    expect(layout.totalHeight).toBe(LAYOUT_PADDING * 2 + first.height * 3 + PAGE_GAP * 2);
  });

  it("pairs pages with the cover alone in spread mode", () => {
    const layout = layoutPages(sizes(5), VIEW, 1, "both");
    expect(layout.spread).toBe("both");
    const rows = [
      [layout.placements[0].page],
      [layout.placements[1].page, layout.placements[2].page],
      [layout.placements[3].page, layout.placements[4].page],
    ];
    expect(rows).toEqual([[1], [2, 3], [4, 5]]);
    // the two pages of a spread share the same top
    expect(layout.placements[1].top).toBe(layout.placements[2].top);
    // horizontal order
    expect(layout.placements[1].left).toBeLessThan(layout.placements[2].left);
  });

  it("supports mixed page sizes without reflowing", () => {
    const mixed: PageSize[] = [LETTER, { width: 400, height: 400 }, LETTER];
    const layout = layoutPages(mixed, VIEW, 1, "none");
    expect(layout.placements[1].width).toBe(Math.round(400 * BASE_SCALE));
    // every page scales against the same reference
    expect(layout.placements[0].width).toBe(Math.round(612 * BASE_SCALE));
  });

  it("handles the empty document", () => {
    const layout = layoutPages([], VIEW, 1, "none");
    expect(layout.placements).toEqual([]);
    expect(layout.totalHeight).toBe(0);
  });
});

describe("pdfLayout · offsets & progression", () => {
  const layout = layoutPages(sizes(), VIEW, 1, "none");
  function sizes(): PageSize[] {
    return Array.from({ length: 10 }, () => LETTER);
  }

  it("finds the page under an offset", () => {
    const first = layout.placements[0];
    expect(pageAtOffset(layout.placements, first.top + 5)).toBe(1);
    const second = layout.placements[1];
    expect(pageAtOffset(layout.placements, second.top + 5)).toBe(2);
    // before the first page and past the last clamp
    expect(pageAtOffset(layout.placements, 0)).toBe(1);
    expect(pageAtOffset(layout.placements, layout.totalHeight + 500)).toBe(10);
  });

  it("brings a page in at its top and round-trips", () => {
    const target = 4;
    const offset = offsetForPage(layout.placements, target, VIEW, layout.totalHeight);
    // the page top is on screen and the viewport center sits inside the page
    const p = layout.placements[target - 1];
    expect(offset).toBeLessThanOrEqual(p.top);
    expect(offset + VIEW.height).toBeGreaterThanOrEqual(p.top + 1);
    expect(pageAtOffset(layout.placements, offset + VIEW.height / 2)).toBe(target);
    // first page starts at the very top; the last page is top-aligned with
    // the padding (its bottom leaves room below — the document end has the
    // same padding, so no forced over-scroll)
    expect(offsetForPage(layout.placements, 1, VIEW, layout.totalHeight)).toBe(0);
    expect(offsetForPage(layout.placements, 10, VIEW, layout.totalHeight)).toBe(
      layout.placements[9].top - LAYOUT_PADDING,
    );
  });

  it("maps progression ↔ page with center rounding", () => {
    expect(progressionForPage(1, 10)).toBeCloseTo(0.05, 5);
    expect(progressionForPage(10, 10)).toBeCloseTo(0.95, 5);
    expect(pageForProgression(0, 10)).toBe(1);
    expect(pageForProgression(1, 10)).toBe(10);
    expect(pageForProgression(0.5, 11)).toBe(6);
    expect(pageForProgression(progressionForPage(7, 10), 10)).toBe(7);
  });
});

describe("pdfLayout · page hrefs", () => {
  it("parses page-N and rejects everything else", () => {
    expect(pageFromHref("page-12")).toBe(12);
    expect(pageFromHref("page-12#frag")).toBe(12);
    expect(pageFromHref("epubcfi(…)")).toBeNull();
    expect(pageFromHref("chapter-2")).toBeNull();
    expect(pageFromHref(null)).toBeNull();
    expect(hrefForPage(3)).toBe("page-3");
  });
});
