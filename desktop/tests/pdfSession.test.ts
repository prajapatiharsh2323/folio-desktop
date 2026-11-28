// PdfSession (non-DOM document state, PDF plan §7) against the real pdf.js
// loader. Node environment (jsdom has no worker support).
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
// Real pdf.js parsing takes >5s on slow CI runners (Windows): lift the
// default test timeout for this file's real-parse tests.
vi.setConfig({ testTimeout: 30_000 });
import { openPdf } from "../src/pdf/pdfjsAdapter";
import { PdfSession } from "../src/pdf/pdfSession";
import { buildSyntheticPdf } from "../src/perf/synthPdf";
import { BASE_SCALE, LAYOUT_PADDING, PAGE_GAP } from "../src/pdf/pdfLayout";
import { DEFAULT_READING_PREFS } from "../src/model/defaults";
import type { ReadingPrefs } from "../src/model/types";

async function sessionFor(
  synth: Parameters<typeof buildSyntheticPdf>[0],
  prefs?: Partial<ReadingPrefs>,
) {
  const bytes = buildSyntheticPdf(synth);
  const opened = await openPdf(new Uint8Array(bytes));
  const session = await PdfSession.open(opened.doc, { ...DEFAULT_READING_PREFS, ...prefs });
  return { opened, session };
}

describe("PdfSession · open", () => {
  it("surveys page sizes and lays out a plain document", async () => {
    const { opened, session } = await sessionFor({ pages: 4 });
    try {
      expect(session.pageCount).toBe(4);
      const layout = session.currentLayout;
      expect(layout.placements).toHaveLength(4);
      // letter pages at fit-width in an 800×1000 viewport
      const scale = (800 - LAYOUT_PADDING * 2) / 612;
      expect(layout.scale).toBeCloseTo(scale, 5);
      expect(layout.placements[0].width).toBe(Math.round(612 * scale));
      expect(layout.placements[0].top).toBe(LAYOUT_PADDING);
      expect(layout.placements[1].top).toBe(LAYOUT_PADDING + Math.round(792 * scale) + PAGE_GAP);
    } finally {
      await opened.destroy();
    }
  });

  it("degrades to synthetic page-group chapters without an outline", async () => {
    const { opened, session } = await sessionFor({ pages: 80, outline: "none" });
    try {
      expect(session.toc.length).toBeGreaterThan(0);
      expect(session.toc.length).toBeLessThanOrEqual(40);
      expect(session.toc[0].href).toBe("page-1");
      // every entry is a page-N href with a page number
      for (const entry of session.toc) expect(entry.href).toMatch(/^page-\d+$/);
    } finally {
      await opened.destroy();
    }
  });

  it("maps a real outline to page-N TOC entries with depth", async () => {
    const { opened, session } = await sessionFor({ pages: 6, outline: "nested" });
    try {
      expect(session.toc.length).toBeGreaterThan(1);
      expect(session.toc.some((e) => e.depth > 0)).toBe(true);
      expect(session.toc.every((e) => /^page-\d+$/.test(e.href))).toBe(true);
    } finally {
      await opened.destroy();
    }
  });

  it("exposes section titles along the reading line", async () => {
    const { opened, session } = await sessionFor({ pages: 6, outline: "flat" });
    try {
      // flat outline: Section 1..5 on pages 1..5
      expect(session.sectionTitleFor(3)).toBe("Section 3");
      expect(session.sectionTitleFor(6)).toBe("Section 5");
    } finally {
      await opened.destroy();
    }
  });
});

describe("PdfSession · zoom & viewport", () => {
  it("zooms by a geometric step and reflows the layout", async () => {
    const { opened, session } = await sessionFor({ pages: 3 });
    try {
      const before = session.currentLayout.scale;
      const zoom = session.zoomBy(1);
      expect(zoom).toBeGreaterThan(1);
      expect(session.currentLayout.scale).toBeGreaterThan(before);
      session.setZoom("fit-width");
      expect(session.currentLayout.scale).toBeCloseTo(before, 5);
    } finally {
      await opened.destroy();
    }
  });

  it("re-lays out when the viewport changes", async () => {
    const { opened, session } = await sessionFor({ pages: 3 }, { spread: "none" });
    try {
      session.setViewport({ width: 1200, height: 900 });
      const scale = (1200 - LAYOUT_PADDING * 2) / 612;
      expect(session.currentLayout.scale).toBeCloseTo(scale, 5);
    } finally {
      await opened.destroy();
    }
  });

  it("keeps the reading fraction inside a page across a resize", async () => {
    const { opened, session } = await sessionFor({ pages: 6 }, { spread: "none" });
    try {
      session.setViewport({ width: 800, height: 1000 });
      session.goToPage(3);
      const from = session.offsetForFraction(0.6);
      session.setViewport({ width: 1000, height: 700 });
      const to = session.offsetForFraction(0.6);
      expect(session.fractionAtOffset(to)).toBeCloseTo(0.6, 1);
      expect(to).not.toBe(from);
    } finally {
      await opened.destroy();
    }
  });

  it("turns one spread row at a time in facing-page mode", async () => {
    const { opened, session } = await sessionFor({ pages: 5 }, { spread: "both" });
    try {
      session.setViewport({ width: 1200, height: 900 });
      expect(session.currentLayout.spread).toBe("both");
      expect(session.stepPage(1, 1)).toBe(2); // cover → first spread
      expect(session.stepPage(2, 1)).toBe(4); // (2,3) → (4,5)
      expect(session.stepPage(4, -1)).toBe(2);
    } finally {
      await opened.destroy();
    }
  });

  it("resolves auto spread against the viewport aspect", async () => {
    const { opened, session } = await sessionFor({ pages: 5 }, { spread: "auto" });
    try {
      session.setViewport({ width: 1400, height: 700 });
      expect(session.currentLayout.spread).toBe("both");
      session.setViewport({ width: 700, height: 1400 });
      expect(session.currentLayout.spread).toBe("none");
    } finally {
      await opened.destroy();
    }
  });
});

describe("PdfSession · locators & progression", () => {
  it("reports 100% on the last page so reading can complete (READ-018)", async () => {
    const { opened, session } = await sessionFor({ pages: 10 });
    try {
      session.goToPage(10);
      expect(session.page).toBe(10);
      expect(session.progression()).toBe(1);
      // scrub-to-end still lands on the last page
      session.goToProgression(1);
      expect(session.page).toBe(10);
      expect(session.progression()).toBe(1);
    } finally {
      await opened.destroy();
    }
  });

  it("round-trips page ↔ offset ↔ locator", async () => {
    const { opened, session } = await sessionFor({ pages: 10 });
    try {
      session.setViewport({ width: 800, height: 1000 });
      session.goToPage(4);
      const offset = session.offsetForPage(4);
      expect(session.pageAtOffset(offset + 5)).toBe(4);
      expect(session.progression()).toBeCloseTo((4 - 0.5) / 10, 5);

      const loc = session.locator("page-4");
      expect(loc.location).toBe("page-4");
      expect(loc.page).toBe(4);
      expect(loc.pageCount).toBe(10);
      expect(loc.chapterHref).toBe("page-4");

      // percent targets map through center-based rounding
      expect(session.pageFromTarget({ percent: 50 })).toBe(5);
      expect(session.pageFromTarget({ location: "page-7" })).toBe(7);
      expect(session.pageFromTarget(null)).toBeNull();

      // scroll sync flips the reading page
      expect(session.syncFromOffset(session.offsetForPage(8))).toBe(true);
      expect(session.page).toBe(8);
      expect(session.syncFromOffset(session.offsetForPage(8))).toBe(false);
    } finally {
      await opened.destroy();
    }
  });

  it("bounds the visible render window with a margin", async () => {
    const { opened, session } = await sessionFor({ pages: 20 });
    try {
      session.setViewport({ width: 800, height: 1000 });
      const [first, last] = session.visibleRange(session.offsetForPage(10), 1000);
      expect(first).toBeLessThanOrEqual(8); // 10 minus the 2-page margin
      expect(last).toBeGreaterThanOrEqual(12);
      expect(first).toBeGreaterThanOrEqual(1);
      expect(last).toBeLessThanOrEqual(20);
    } finally {
      await opened.destroy();
    }
  });
});

describe("PdfSession · zoom 1 geometry", () => {
  it("renders zoom 1 at 96/72 CSS px per point", async () => {
    const { opened, session } = await sessionFor({ pages: 2 });
    try {
      session.setViewport({ width: 2000, height: 2000 });
      session.setZoom(1);
      const layout = session.currentLayout;
      expect(layout.scale).toBeCloseTo(BASE_SCALE, 5);
      expect(layout.placements[0].width).toBe(816); // 612 pt letter
      expect(layout.placements[0].height).toBe(1056); // 792 pt letter
    } finally {
      await opened.destroy();
    }
  });
});
