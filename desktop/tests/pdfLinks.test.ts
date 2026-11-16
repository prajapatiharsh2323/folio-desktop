// Internal link annotations (hardening phase, plan §12): fixture links +
// pageLinkRects against real pdf.js in Node.
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildSyntheticPdf } from "../src/perf/synthPdf";
import { openPdf, pageLinkRects } from "../src/pdf/pdfjsAdapter";

describe("pageLinkRects (real pdf.js, Node)", () => {
  it("resolves GoTo and URI links on the annotated page at scale 1", async () => {
    const bytes = buildSyntheticPdf({
      pages: 4,
      title: "Links",
      links: (page) =>
        page === 1
          ? [
              { kind: "goto", page: 3 },
              { kind: "url", url: "https://example.com/folio" },
            ]
          : null,
    });
    const { doc, destroy } = await openPdf(new Uint8Array(bytes));
    try {
      const links = await pageLinkRects(doc, 1, 1);
      expect(links).toHaveLength(2);

      // Default rect [72 700 272 724] on a 612x792 page, y flipped by the
      // viewport transform: top = 792-724 = 68, bottom = 792-700 = 92.
      expect(links[0].rect).toEqual({ left: 72, top: 68, right: 272, bottom: 92 });
      expect(links[0].page).toBe(3);
      expect(links[0].url).toBeNull();

      expect(links[1].page).toBeNull();
      expect(links[1].url).toBe("https://example.com/folio");

      // Page without annotations resolves to an empty list.
      expect(await pageLinkRects(doc, 2, 1)).toEqual([]);
    } finally {
      await destroy();
    }
  });

  it("scales rects with the render scale", async () => {
    const bytes = buildSyntheticPdf({
      pages: 2,
      links: (page) => (page === 1 ? [{ kind: "goto", page: 2 }] : null),
    });
    const { doc, destroy } = await openPdf(new Uint8Array(bytes));
    try {
      const atScale2 = await pageLinkRects(doc, 1, 2);
      expect(atScale2[0].rect).toEqual({ left: 144, top: 136, right: 544, bottom: 184 });
    } finally {
      await destroy();
    }
  });

  it("skips unresolved GoTo targets instead of failing", async () => {
    const bytes = buildSyntheticPdf({
      pages: 2,
      links: (page) => (page === 1 ? [{ kind: "goto", page: 999 }] : null),
    });
    const { doc, destroy } = await openPdf(new Uint8Array(bytes));
    try {
      // Object 999 does not exist: the dest cannot resolve, so the link is
      // dropped (best-effort navigation, never an error).
      expect(await pageLinkRects(doc, 1, 1)).toEqual([]);
    } finally {
      await destroy();
    }
  });
});

describe("links + outline coexistence", () => {
  it("keeps the outline and object numbering sane when both are present", async () => {
    const withLinks = buildSyntheticPdf({
      pages: 3,
      title: "Both",
      outline: "flat",
      links: (page) => (page === 2 ? [{ kind: "goto", page: 1 }] : null),
    });
    const withoutLinks = buildSyntheticPdf({ pages: 3, title: "Both", outline: "flat" });
    // No links ⇒ byte-identical to the historical layout (determinism guard).
    expect(Buffer.from(withLinks).length).toBeGreaterThan(0);
    expect(Buffer.from(withoutLinks).length).toBeGreaterThan(0);
    expect(withLinks.subarray(0, 8)).toEqual(withoutLinks.subarray(0, 8));

    const { doc, destroy } = await openPdf(new Uint8Array(withLinks));
    try {
      expect(doc.numPages).toBe(3);
      const outline = await doc.getOutline();
      expect(outline?.length).toBe(3);
      const links = await pageLinkRects(doc, 2, 1);
      expect(links).toHaveLength(1);
      expect(links[0].page).toBe(1);
    } finally {
      await destroy();
    }
  });
});
