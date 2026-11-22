// Format-specific models: the legacy schema-1 contract stays intact while
// EPUB/PDF settings are separated and migrated without reusing pdfZoom.
import { describe, it, expect } from "vitest";
import { DEFAULT_READING_PREFS } from "../src/model/defaults";
import {
  DEFAULT_PDF_READER_PREFS,
  epubPrefsFrom,
  pdfPrefsFromLegacy,
  pdfToReadingPrefs,
  resolvePdfPrefs,
} from "../src/model/formatPrefs";

describe("format-specific preference models", () => {
  it("extracts the EPUB-owned fields from legacy ReadingPrefs", () => {
    const epub = epubPrefsFrom({
      ...DEFAULT_READING_PREFS,
      fontSize: 24,
      margin: 42,
      pdfZoom: "legacy-should-not-matter",
    });
    expect(epub).toMatchObject({ fontSize: 24, margin: 42, theme: "light" });
    expect(epub).not.toHaveProperty("pdfZoom");
  });

  it("seeds PDF prefs from legacy shared meanings but never from pdfZoom", () => {
    const pdf = pdfPrefsFromLegacy({
      ...DEFAULT_READING_PREFS,
      theme: "true-black",
      brightness: 55,
      flow: "scrolled",
      spread: "both",
      pdfZoom: "2.0",
    });
    expect(pdf).toMatchObject({
      theme: "true-black",
      brightness: 55,
      flow: "scrolled",
      spread: "both",
    });
    expect(pdf).not.toHaveProperty("pdfZoom");
    expect(pdf.zoom).toBe(DEFAULT_PDF_READER_PREFS.zoom);
  });

  it("keeps pdfZoom dead and never applies the EPUB width cap to PDF", () => {
    const engineView = pdfToReadingPrefs({
      ...DEFAULT_PDF_READER_PREFS,
      theme: "dark",
      brightness: 80,
    });
    expect(engineView.pdfZoom).toBe("");
    expect(engineView.maxWidth).toBe(0);
    expect(engineView).toMatchObject({ theme: "dark", brightness: 80 });
  });

  it("fills missing fields for older PDF preference records", () => {
    expect(resolvePdfPrefs({ theme: "warm" } as never)).toMatchObject({
      theme: "warm",
      rotation: DEFAULT_PDF_READER_PREFS.rotation,
      presentation: DEFAULT_PDF_READER_PREFS.presentation,
    });
  });
});
