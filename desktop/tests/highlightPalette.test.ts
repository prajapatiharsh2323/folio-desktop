// R16: one theme-aware highlight palette. Every canvas decoration fill must
// keep ≥4.5:1 contrast against the page text of the reader theme it paints
// on, the mapping covers light and dark OS flags, and decorationsFor threads
// the flag through to the engine specs.
import { describe, it, expect } from "vitest";
import {
  HIGHLIGHT_DARK,
  HIGHLIGHT_LIGHT,
  highlightCss,
  searchActiveCss,
} from "../src/reader/highlightPalette";
import { decorationsFor } from "../src/screens/reader/decorations";
import { READER_THEME_COLORS } from "../src/model/defaults";
import type { Annotation } from "../src/model/types";

/** WCAG 2.1 relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** The four concrete reader themes and the OS flag that resolves to each. */
const THEMES: { theme: string; systemDark: boolean }[] = [
  { theme: "light", systemDark: false },
  { theme: "warm", systemDark: false },
  { theme: "dark", systemDark: true },
  { theme: "true-black", systemDark: true },
];

describe("highlight palette (R16)", () => {
  it("maps colour names to the palette matching the OS dark flag", () => {
    expect(highlightCss("yellow", false)).toBe(HIGHLIGHT_LIGHT.yellow);
    expect(highlightCss("pink", true)).toBe(HIGHLIGHT_DARK.pink);
    // Null / unknown names fall back to yellow in the right palette.
    expect(highlightCss(null, false)).toBe(HIGHLIGHT_LIGHT.yellow);
    expect(highlightCss("magenta", true)).toBe(HIGHLIGHT_DARK.yellow);
  });

  it("dark tints differ from light tints for every colour", () => {
    for (const name of ["yellow", "green", "blue", "pink"] as const) {
      expect(HIGHLIGHT_DARK[name]).not.toBe(HIGHLIGHT_LIGHT[name]);
    }
  });

  it("every tint keeps ≥4.5:1 contrast with its theme's page text", () => {
    for (const { theme, systemDark } of THEMES) {
      const pageText = READER_THEME_COLORS[theme].text;
      const palette = systemDark ? HIGHLIGHT_DARK : HIGHLIGHT_LIGHT;
      const fills = [
        palette.yellow,
        palette.green,
        palette.blue,
        palette.pink,
        searchActiveCss(systemDark),
      ];
      for (const fill of fills) {
        expect(contrast(pageText, fill)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("decorationsFor threads the OS flag into engine specs", () => {
    const annotation: Annotation = {
      id: "a1",
      docId: "d1",
      chapterId: "c1",
      quote: "quoted text",
      prefix: "",
      suffix: "",
      location: "epubcfi(/6/2)",
      kind: "highlight",
      color: "blue",
      note: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const lightSpec = decorationsFor([annotation], false)[0];
    const darkSpec = decorationsFor([annotation], true)[0];
    expect(lightSpec.color).toBe(HIGHLIGHT_LIGHT.blue);
    expect(darkSpec.color).toBe(HIGHLIGHT_DARK.blue);
  });
});
