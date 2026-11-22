// Theme-aware highlight palette. Every canvas decoration fill must keep
// ≥4.5:1 contrast against each reader theme's page text, the palette must
// follow the *effective* theme (manual Dark on a light OS included), and the
// mapped Readium decoration must actually carry the tint to the navigator.
import { describe, it, expect } from "vitest";
import { Locator } from "@readium/shared";
import {
  HIGHLIGHT_DARK,
  HIGHLIGHT_LIGHT,
  highlightCss,
  isDarkReaderTheme,
  searchActiveCss,
} from "../src/reader/highlightPalette";
import { resolveReaderTheme } from "../src/reader/readerThemes";
import { toReadiumDecoration } from "../src/reader/readiumEngine";
import { DecorationStyleType } from "@readium/navigator";
import { decorationsFor } from "../src/screens/reader/decorations";
import { READER_THEME_COLORS } from "../src/model/defaults";
import type { Annotation, ReadingTheme } from "../src/model/types";

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

const THEMES: ReadingTheme[] = ["light", "warm", "dark", "true-black"];
const COLORS = ["yellow", "green", "blue", "pink"] as const;

function annotation(color: string): Annotation {
  return {
    id: "a1",
    docId: "d1",
    chapterId: "c1",
    quote: "quoted text",
    prefix: "",
    suffix: "",
    location: "ch1.xhtml?p=0.2",
    kind: "highlight",
    color: color as Annotation["color"],
    note: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("highlight palette", () => {
  it("maps colour names to the palette matching the resolved reader theme", () => {
    for (const systemDark of [false, true]) {
      const light = resolveReaderTheme("light", systemDark);
      const dark = resolveReaderTheme("dark", systemDark);
      expect(highlightCss("yellow", light)).toBe(HIGHLIGHT_LIGHT.yellow);
      expect(highlightCss("pink", dark)).toBe(HIGHLIGHT_DARK.pink);
      // Null / unknown names fall back to yellow in the right palette.
      expect(highlightCss(null, light)).toBe(HIGHLIGHT_LIGHT.yellow);
      expect(highlightCss("magenta", dark)).toBe(HIGHLIGHT_DARK.yellow);
    }
  });

  it("uses the manual theme, independent of the Windows appearance", () => {
    // The original bug: the OS flag chose the palette, so a manual Dark theme
    // on a light OS still painted light tints.
    expect(isDarkReaderTheme(resolveReaderTheme("dark", false).theme)).toBe(true);
    expect(highlightCss("blue", resolveReaderTheme("dark", false))).toBe(HIGHLIGHT_DARK.blue);
    expect(highlightCss("blue", resolveReaderTheme("true-black", false))).toBe(HIGHLIGHT_DARK.blue);
    expect(highlightCss("blue", resolveReaderTheme("warm", true))).toBe(HIGHLIGHT_LIGHT.blue);
    expect(highlightCss("blue", resolveReaderTheme("system", true))).toBe(HIGHLIGHT_DARK.blue);
    expect(highlightCss("blue", resolveReaderTheme("system", false))).toBe(HIGHLIGHT_LIGHT.blue);
  });

  it("dark tints differ from light tints for every colour", () => {
    for (const name of COLORS) {
      expect(HIGHLIGHT_DARK[name]).not.toBe(HIGHLIGHT_LIGHT[name]);
    }
  });

  it("every tint keeps ≥4.5:1 contrast with its theme's page text", () => {
    for (const theme of THEMES) {
      const resolved = resolveReaderTheme(theme, false);
      const pageText = READER_THEME_COLORS[theme].text;
      const palette = isDarkReaderTheme(resolved.theme) ? HIGHLIGHT_DARK : HIGHLIGHT_LIGHT;
      const fills = [...COLORS.map((name) => palette[name]), searchActiveCss(resolved)];
      for (const fill of fills) {
        expect(contrast(pageText, fill)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("decorationsFor threads the effective theme into engine specs", () => {
    const light = resolveReaderTheme("warm", true); // manual Paper on dark OS
    const dark = resolveReaderTheme("dark", false); // manual Dark on light OS
    expect(decorationsFor([annotation("blue")], light)[0].color).toBe(HIGHLIGHT_LIGHT.blue);
    expect(decorationsFor([annotation("blue")], dark)[0].color).toBe(HIGHLIGHT_DARK.blue);
  });
});

describe("Readium decoration mapping", () => {
  it("passes type + tint to the navigator (a bare string falls back to yellow)", () => {
    const locator = new Locator({ href: "ch1.xhtml", type: "application/xhtml+xml" });
    const decoration = toReadiumDecoration(
      { id: "h1", locator: "ch1.xhtml", style: "highlight", color: HIGHLIGHT_DARK.pink },
      locator,
    );
    expect(decoration.id).toBe("h1");
    expect(decoration.locator).toBe(locator);
    expect(decoration.style).toEqual({
      type: DecorationStyleType.Highlight,
      tint: HIGHLIGHT_DARK.pink,
      enforceContrast: false,
    });
  });

  it("maps underline specs to the underline decoration type", () => {
    const locator = new Locator({ href: "ch1.xhtml", type: "application/xhtml+xml" });
    const decoration = toReadiumDecoration(
      { id: "u1", locator: "ch1.xhtml", style: "underline", color: "#123456" },
      locator,
    );
    expect(decoration.style).toMatchObject({
      type: DecorationStyleType.Underline,
      tint: "#123456",
    });
  });
});
