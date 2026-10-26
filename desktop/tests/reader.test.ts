import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import { openEpubFromBytes } from "../src/reader/epubPublication";
import { generatePositions, progressionForLocator, locatorForProgression, POSITION_LENGTH } from "../src/reader/positions";
import { resumePlan, isCfi } from "../src/reader/resume";
import { ReadingPaceStats, formatTimeLeft } from "../src/reader/pace";
import { ProgressWriter } from "../src/reader/progress";
import { ChromeStateMachine } from "../src/reader/chrome";
import { resolveReaderTheme, typefaceStack, scrimAlpha, toNavigatorPreferences } from "../src/reader/readerThemes";

function makeEpub(
  title = "T",
  chapters: { id: string; title: string; body: string }[] = [
    { id: "c1", title: "One", body: "Hello world chapter one." },
    { id: "c2", title: "Two", body: "Second chapter text." },
  ]
): Uint8Array {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:x</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${chapters.map((c) => `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}
  </manifest>
  <spine>
    ${chapters.map((c) => `<itemref idref="${c.id}"/>`).join("\n")}
  </spine>
</package>`;
  const nav = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        ${chapters.map((c) => `<li><a href="${c.id}.xhtml">${c.title}</a></li>`).join("")}
      </ol>
    </nav>
  </body>
</html>`;
  const entries: Record<string, Uint8Array> = {
    "META-INF/container.xml": strToU8(
      `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
      </container>`
    ),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/nav.xhtml": strToU8(nav),
  };
  for (const c of chapters) {
    entries[`OEBPS/${c.id}.xhtml`] = strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${c.title}</h1><p>${c.body}</p></body></html>`
    );
  }
  return zipSync(entries);
}

describe("epubPublication", () => {
  it("parses metadata, spine and TOC", () => {
    const pkg = openEpubFromBytes(makeEpub("Moby", [
      { id: "a", title: "A", body: "alpha" },
    ]));
    expect(pkg.publication.metadata.title.translations.und).toBe("Moby");
    expect(pkg.publication.readingOrder.items.length).toBe(1);
    expect(pkg.publication.toc?.items.length).toBe(1);
    expect(pkg.publication.toc?.items[0].title).toBe("A");
    expect(pkg.positions.length).toBeGreaterThanOrEqual(1);
    pkg.close();
  });

  it("positions carry href + progression + totalProgression", () => {
    const pkg = openEpubFromBytes(makeEpub("T"));
    const first = pkg.positions[0];
    expect(first.locations.position).toBe(1);
    expect(first.locations.totalProgression).toBe(0);
    expect(first.href).toContain(".xhtml");
    pkg.close();
  });

  it("generates at least one position per spine item", () => {
    const pkg = openEpubFromBytes(makeEpub("T"));
    const hrefs = new Set(pkg.positions.map((p) => p.href));
    expect(hrefs.size).toBe(2);
    pkg.close();
  });
});

describe("positions", () => {
  it("POSITION_LENGTH is 1024", () => {
    expect(POSITION_LENGTH).toBe(1024);
  });

  it("progressionForLocator returns 0..1", () => {
    const pkg = openEpubFromBytes(makeEpub("T"));
    const p = progressionForLocator(pkg.positions[1], pkg.positions);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
    pkg.close();
  });

  it("locatorForProgression clamps and lands inside list", () => {
    const pkg = openEpubFromBytes(makeEpub("T"));
    expect(locatorForProgression(0, pkg.positions)?.href).toBe(pkg.positions[0].href);
    expect(locatorForProgression(2, pkg.positions)?.href).toBe(
      pkg.positions[pkg.positions.length - 1].href
    );
    pkg.close();
  });

  it("generatePositions assigns one position per resource when short", () => {
    const pkg = openEpubFromBytes(makeEpub("T"));
    const positions = generatePositions(pkg.publication, pkg.zip);
    expect(positions.length).toBe(pkg.positions.length);
    pkg.close();
  });
});

describe("resumePlan", () => {
  it("isCfi detects epubcfi strings", () => {
    expect(isCfi("epubcfi(/6/2[x]!/4/2)")).toBe(true);
    expect(isCfi("chapter.xhtml")).toBe(false);
  });

  it("override location wins", () => {
    const plan = resumePlan(
      { location: "old.xhtml", percent: 50 },
      { location: "new.xhtml", percent: 90 }
    );
    expect(plan.kind).toBe("override-locator");
    if (plan.kind === "override-locator") expect(plan.locator).toBe("new.xhtml");
  });

  it("override percent when no location", () => {
    const plan = resumePlan(null, { percent: 42 });
    expect(plan.kind).toBe("override-percent");
  });

  it("CFI location falls back to percent", () => {
    const plan = resumePlan({ location: "epubcfi(/6/2!)", percent: 33 }, null);
    expect(plan.kind).toBe("cfi");
  });

  it("plain saved progress → percent", () => {
    const plan = resumePlan({ location: "ch.xhtml", percent: 60 }, null);
    expect(plan.kind).toBe("percent");
  });

  it("no progress → first", () => {
    expect(resumePlan(null, null).kind).toBe("first");
  });
});

describe("ReadingPaceStats", () => {
  it("first forward move anchors without credit", () => {
    const pace = new ReadingPaceStats();
    const t0 = 1000;
    pace.onForwardMove(10, t0);
    expect(pace.state().sessionsMs).toBe(0);
    expect(pace.state().percentRead).toBe(10);
  });

  it("continuous forward move credits the gap", () => {
    const pace = new ReadingPaceStats();
    pace.onForwardMove(10, 1000);
    pace.onForwardMove(12, 2000);
    expect(pace.state().sessionsMs).toBe(1000);
  });

  it("jump >= 5pp does not credit", () => {
    const pace = new ReadingPaceStats();
    pace.onForwardMove(10, 1000);
    pace.onForwardMove(20, 2000);
    expect(pace.state().sessionsMs).toBe(0);
  });

  it("backward move does not credit", () => {
    const pace = new ReadingPaceStats();
    pace.onForwardMove(20, 1000);
    pace.onForwardMove(15, 2000);
    expect(pace.state().sessionsMs).toBe(0);
  });

  it("breakSession re-anchors without credit", () => {
    const pace = new ReadingPaceStats();
    pace.onForwardMove(10, 1000);
    pace.breakSession(1500);
    pace.onForwardMove(12, 2000);
    expect(pace.state().sessionsMs).toBe(0);
  });

  it("timeLeftMinutes guards zero percentRead", () => {
    const pace = new ReadingPaceStats();
    expect(pace.timeLeftMinutes(10)).toBeNull();
  });

  it("timeLeftMinutes computes remaining time", () => {
    const pace = new ReadingPaceStats({ sessionsMs: 60_000, percentRead: 50 });
    // 1 minute spent for 50%; remaining 50% → 1 minute
    expect(pace.timeLeftMinutes(50)).toBeCloseTo(1, 5);
  });

  it("formatTimeLeft renders thresholds", () => {
    expect(formatTimeLeft(null)).toBeNull();
    expect(formatTimeLeft(0.5)).toBeNull();
    expect(formatTimeLeft(12)).toBe("≈ 12 min left");
    expect(formatTimeLeft(120)).toBe("≈ 2 h left");
  });
});

describe("ProgressWriter", () => {
  it("writes the first locator", async () => {
    let written = 0;
    const writer = new ProgressWriter(async () => {
      written += 1;
    });
    const ok = await writer.onLocator({ location: "a", percent: 10 });
    expect(ok).toBe(true);
    expect(written).toBe(1);
  });

  it("gates on <0.4% change within 500 ms", async () => {
    let written = 0;
    let now = 1000;
    const writer = new ProgressWriter(async () => {
      written += 1;
    }, () => now);
    await writer.onLocator({ location: "a", percent: 10 });
    now = 1100;
    const ok = await writer.onLocator({ location: "a", percent: 10.1 });
    expect(ok).toBe(false);
    expect(written).toBe(1);
  });

  it("writes when location changes after 500 ms", async () => {
    let written = 0;
    let now = 1000;
    const writer = new ProgressWriter(async () => {
      written += 1;
    }, () => now);
    await writer.onLocator({ location: "a", percent: 10 });
    now = 1600;
    const ok = await writer.onLocator({ location: "b", percent: 10.1 });
    expect(ok).toBe(true);
    expect(written).toBe(2);
  });

  it("flush writes the pending snapshot", async () => {
    let written = 0;
    let now = 1000;
    const writer = new ProgressWriter(async () => {
      written += 1;
    }, () => now);
    await writer.onLocator({ location: "a", percent: 10 });
    now = 1050;
    await writer.onLocator({ location: "a", percent: 10.1 });
    const flushed = await writer.flush();
    expect(flushed).toBe(true);
    expect(written).toBe(2);
  });

  it("scrub writes are suppressed for 60 s after restore", async () => {
    let written = 0;
    let now = 1000;
    const writer = new ProgressWriter(async () => {
      written += 1;
    }, () => now);
    await writer.writeRestored({ location: "a", percent: 10 });
    const before = written;
    now = 1500;
    const ok = await writer.onScrub({ location: "b", percent: 20 });
    expect(ok).toBe(false);
    expect(written).toBe(before);
  });

  it("locator writes are not suppressed after restore", async () => {
    let written = 0;
    let now = 1000;
    const writer = new ProgressWriter(async () => {
      written += 1;
    }, () => now);
    await writer.writeRestored({ location: "a", percent: 10 });
    const before = written;
    now = 1500;
    const ok = await writer.onLocator({ location: "b", percent: 20 });
    expect(ok).toBe(true);
    expect(written).toBe(before + 1);
  });
});

describe("ChromeStateMachine", () => {
  it("starts visible", () => {
    let now = 0;
    const chrome = new ChromeStateMachine(() => now);
    expect(chrome.visible).toBe(true);
  });

  it("hides after 3 s of inactivity", () => {
    let now = 0;
    const chrome = new ChromeStateMachine(() => now);
    now = 3500;
    expect(chrome.tick()).toBe("hidden");
  });

  it("onActivity reschedules", () => {
    let now = 0;
    const chrome = new ChromeStateMachine(() => now);
    now = 2500;
    chrome.onActivity();
    now = 4000;
    expect(chrome.tick()).toBe("visible");
  });

  it("toggle flips visibility", () => {
    let now = 0;
    const chrome = new ChromeStateMachine(() => now);
    chrome.toggle();
    expect(chrome.visible).toBe(false);
    chrome.toggle();
    expect(chrome.visible).toBe(true);
  });

  it("zoneForClick thirds", () => {
    expect(ChromeStateMachine.zoneForClick(10, 300)).toBe("back");
    expect(ChromeStateMachine.zoneForClick(150, 300)).toBe("toggle");
    expect(ChromeStateMachine.zoneForClick(290, 300)).toBe("forward");
  });

  it("scrub grace hides after 1.2 s", () => {
    let now = 0;
    const chrome = new ChromeStateMachine(() => now);
    chrome.onScrubStart();
    now = 100;
    chrome.onScrubEnd();
    now = 200;
    expect(chrome.tick()).toBe("visible");
    now = 1500;
    expect(chrome.tick()).toBe("hidden");
  });
});

describe("readerThemes", () => {
  it("resolveReaderTheme resolves system using OS dark", () => {
    const light = resolveReaderTheme("system", false);
    const dark = resolveReaderTheme("system", true);
    expect(light.theme).toBe("light");
    expect(dark.theme).toBe("dark");
    expect(light.pageBg).toBe("#FAFAF7");
    expect(dark.pageBg).toBe("#121214");
  });

  it("warm theme keeps paper palette", () => {
    const theme = resolveReaderTheme("warm", false);
    expect(theme.pageBg).toBe("#F4ECD8");
    expect(theme.pageText).toBe("#3B3226");
  });

  it("typefaceStack returns null for publisher", () => {
    expect(typefaceStack("publisher")).toBeNull();
    expect(typefaceStack("serif")).toContain("Georgia");
  });

  it("scrimAlpha maps brightness", () => {
    expect(scrimAlpha(100)).toBe(0);
    expect(scrimAlpha(30)).toBeCloseTo(0.49, 2);
  });

  it("toNavigatorPreferences maps flow and sizes", () => {
    const theme = resolveReaderTheme("light", false);
    const mapped = toNavigatorPreferences(
      {
        schema: 1,
        theme: "light",
        fontFamily: "serif",
        fontSize: 18,
        lineHeight: 1.6,
        margin: 20,
        justify: true,
        hyphenate: false,
        paragraphSpacing: 0.2,
        letterSpacing: 0.05,
        maxWidth: 0,
        brightness: 100,
        flow: "scrolled",
        spread: "auto",
        pdfZoom: "",
      },
      theme
    );
    expect(mapped.fontSize).toBeCloseTo(18 / 16);
    expect(mapped.scroll).toBe(true);
    expect(mapped.textAlign).toBe("justify");
  });
});
