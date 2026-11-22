// Complete-range EPUB highlighting. A Readium decoration's painted DOM Range is
// resolved from `Locator.text.highlight` with a TextQuoteAnchor, so the full
// selected quote must survive selection -> annotation -> decoration. jsdom
// proves the *data* contract here; actual per-line painting still needs a
// Windows/WebView2 QA pass on a styled EPUB.
import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { Locator, LocatorText } from "@readium/shared";
import { createReadiumEngine, toReadiumDecoration } from "../src/reader/readiumEngine";
import { DEFAULT_READING_PREFS } from "../src/model/defaults";
import { decorationsFor } from "../src/screens/reader/decorations";
import { decodeLocation, MAX_DECORATION_ANCHOR_CHARS } from "../src/reader/locatorCodec";
import type { Annotation } from "../src/model/types";

/** A paragraph-length selection spanning several visual lines and inline markup. */
const LONG_QUOTE = [
  "This is the first line of a paragraph that should be highlighted completely even when the selected text continues onto another visual line.",
  "It contains normal text, bold text and italic text, plus a nested span with punctuation — commas, semicolons; and parentheses (like these).",
  "The paragraph wraps across several rendered lines and ends here with a final sentence.",
].join(" ");

function annotation(quote: string, location: string): Annotation {
  return {
    id: "h1",
    docId: "doc-1",
    chapterId: "ch1",
    quote,
    prefix: "before ",
    suffix: " after",
    location,
    kind: "highlight",
    color: "yellow",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeEpub(body: string): Uint8Array {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:x</dc:identifier>
    <dc:title>Range</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
  const nav = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body>
</html>`;
  return zipSync({
    "META-INF/container.xml": strToU8(
      `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
      </container>`,
    ),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/nav.xhtml": strToU8(nav),
    "OEBPS/c1.xhtml": strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>One</h1><p>${body}</p></body></html>`,
    ),
  });
}

describe("complete-range EPUB decorations", () => {
  it("keeps a multi-line quote through the annotation -> decoration mapping", () => {
    expect(LONG_QUOTE.length).toBeGreaterThan(200);
    const spec = decorationsFor([annotation(LONG_QUOTE, "ch1.xhtml?p=0.25")], "light")[0];

    const decoded = decodeLocation(spec.locator, MAX_DECORATION_ANCHOR_CHARS)!;
    expect(decoded.anchor?.quote).toBe(LONG_QUOTE);

    // Same construction locatorFromString() performs before handing the
    // decoration to the navigator.
    const locator = new Locator({
      href: decoded.href,
      type: "application/xhtml+xml",
      text: new LocatorText({
        highlight: decoded.anchor!.quote,
        before: decoded.anchor!.prefix,
        after: decoded.anchor!.suffix,
      }),
    });
    const decoration = toReadiumDecoration(spec, locator);
    expect(decoration.locator.text?.highlight).toBe(LONG_QUOTE);
    expect(decoration.locator.text?.before).toBe("before ");
    expect(decoration.locator.text?.after).toBe(" after");
  });

  it("hands the navigator a Locator whose text anchor is the full selection", async () => {
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
    const engine = createReadiumEngine({
      epubBytes: makeEpub(LONG_QUOTE),
      prefs: DEFAULT_READING_PREFS,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await engine.open(container);

    const internals = engine as unknown as {
      navigator: { applyDecorations: (decorations: unknown[], group: string) => void };
      positions: { href: string }[];
    };
    const href = internals.positions[0].href;
    const apply = vi.spyOn(internals.navigator, "applyDecorations");

    await engine.applyDecorations(
      decorationsFor([annotation(LONG_QUOTE, `${href}?p=0.2`)], "dark"),
    );

    expect(apply).toHaveBeenCalledTimes(1);
    const passed = apply.mock.calls[0][0] as Array<{ locator: Locator }>;
    expect(passed).toHaveLength(1);
    expect(passed[0].locator.text?.highlight).toBe(LONG_QUOTE);

    apply.mockRestore();
    await engine.destroy();
    document.body.removeChild(container);
  });
});
