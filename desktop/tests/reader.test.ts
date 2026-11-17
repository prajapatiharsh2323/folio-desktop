import { createReadiumEngine } from "../src/reader/readiumEngine";
import { DEFAULT_READING_PREFS } from "../src/model/defaults";
import { describe, it, expect, vi } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { openEpubFromBytes, openEpubFromBytesAsync } from "../src/reader/epubPublication";
import {
  generatePositions,
  progressionForLocator,
  locatorForProgression,
  POSITION_LENGTH,
} from "../src/reader/positions";
import { resumePlan, isCfi } from "../src/reader/resume";
import { ReadingPaceStats, formatTimeLeft, formatChapterTimeLeft } from "../src/reader/pace";
import { ProgressWriter } from "../src/reader/progress";
import {
  ChromeStateMachine,
  intentForReaderClick,
  readerEdgeZoneWidth,
} from "../src/reader/chrome";
import {
  EPUB_SPREAD_MIN_WIDTH,
  resolveEpubColumnCount,
  resolveReaderTheme,
  typefaceStack,
  scrimAlpha,
  toNavigatorPreferences,
} from "../src/reader/readerThemes";

function makeEpub(
  title = "T",
  chapters: { id: string; title: string; body: string }[] = [
    { id: "c1", title: "One", body: "Hello world chapter one." },
    { id: "c2", title: "Two", body: "Second chapter text." },
  ],
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
      </container>`,
    ),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/nav.xhtml": strToU8(nav),
  };
  for (const c of chapters) {
    entries[`OEBPS/${c.id}.xhtml`] = strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${c.title}</h1><p>${c.body}</p></body></html>`,
    );
  }
  return zipSync(entries);
}

describe("epubPublication", () => {
  it("parses metadata, spine and TOC", () => {
    const pkg = openEpubFromBytes(makeEpub("Moby", [{ id: "a", title: "A", body: "alpha" }]));
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

  it("opens a package whose container full-path is percent-encoded", () => {
    const entries = unzipSync(makeEpub("Encoded", [{ id: "a", title: "A", body: "alpha" }]));
    entries["META-INF/container.xml"] = strToU8(
      `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content%2Eopf" media-type="application/oebps-package+xml"/></rootfiles>
      </container>`,
    );
    const pkg = openEpubFromBytes(zipSync(entries));
    expect(pkg.publication.metadata.title.translations.und).toBe("Encoded");
    pkg.close();
  });

  it("async open reports unpack then ascending prepare progress (R12)", async () => {
    const bytes = makeEpub("Async", [
      { id: "a", title: "A", body: "alpha text ".repeat(600) },
      { id: "b", title: "B", body: "beta text ".repeat(600) },
    ]);
    const seen: { stage: string; fraction: number | null }[] = [];
    const pkg = await openEpubFromBytesAsync(bytes, (p) => seen.push({ ...p }));
    expect(seen[0]).toEqual({ stage: "unpack", fraction: null });
    expect(seen[1]).toEqual({ stage: "prepare", fraction: 0 });
    const prepares = seen.slice(1);
    expect(prepares[prepares.length - 1].fraction).toBe(1);
    // Fractions never regress and stay in 0..1.
    for (let i = 1; i < prepares.length; i++) {
      expect(prepares[i].fraction!).toBeGreaterThan(prepares[i - 1].fraction!);
    }
    pkg.close();
  });

  it("async open produces the identical positions list to the sync path (R12)", async () => {
    const bytes = makeEpub("Parity", [
      { id: "a", title: "A", body: "alpha text ".repeat(400) },
      { id: "b", title: "B", body: "beta text ".repeat(400) },
      { id: "c", title: "C", body: "gamma text ".repeat(400) },
    ]);
    const syncPkg = openEpubFromBytes(bytes);
    const asyncPkg = await openEpubFromBytesAsync(bytes);
    expect(asyncPkg.positions.length).toBe(syncPkg.positions.length);
    expect(asyncPkg.opfPath).toBe(syncPkg.opfPath);
    expect(asyncPkg.publication.metadata.title.translations.und).toBe(
      syncPkg.publication.metadata.title.translations.und,
    );
    const syncKeys = syncPkg.positions.map((p) => `${p.href}@${p.locations.position}`);
    const asyncKeys = asyncPkg.positions.map((p) => `${p.href}@${p.locations.position}`);
    expect(asyncKeys).toEqual(syncKeys);
    syncPkg.close();
    asyncPkg.close();
  });

  it("the lazy zip map behaves like the eager map (R12)", async () => {
    const bytes = makeEpub("Lazy", [{ id: "a", title: "A", body: "alpha" }]);
    const pkg = await openEpubFromBytesAsync(bytes);
    const eager = unzipSync(bytes);

    // Object.keys lists every archive entry without decompressing them all.
    expect(new Set(Object.keys(pkg.zip))).toEqual(new Set(Object.keys(eager)));
    // Entry reads decompress on demand and match the eager bytes.
    for (const key of Object.keys(eager)) {
      expect(Buffer.from(pkg.zip[key])).toEqual(Buffer.from(eager[key]));
    }
    // `in` membership matches too.
    expect("META-INF/container.xml" in pkg.zip).toBe(true);
    expect("missing-file.xhtml" in pkg.zip).toBe(false);
    expect(pkg.zip["missing-file.xhtml"]).toBeUndefined();
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
      pkg.positions[pkg.positions.length - 1].href,
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
      { location: "new.xhtml", percent: 90 },
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

  it("saved href + progression resumes exactly, not by coarse percent", () => {
    const plan = resumePlan({ location: "ch.xhtml?p=0.428612&q=the%20whale", percent: 60 }, null);
    expect(plan.kind).toBe("saved-locator");
    if (plan.kind === "saved-locator") {
      expect(plan.locator).toBe("ch.xhtml?p=0.428612&q=the%20whale");
      expect(plan.percent).toBe(60);
    }
  });

  it("legacy plain href progress still resumes at the chapter", () => {
    const plan = resumePlan({ location: "ch.xhtml", percent: 60 }, null);
    expect(plan.kind).toBe("saved-locator");
  });

  it("unusable saved location → percent", () => {
    const plan = resumePlan({ location: "", percent: 60 }, null);
    expect(plan.kind).toBe("percent");
    if (plan.kind === "percent") expect(plan.percent).toBe(60);
  });

  it("override anchor is merged into a single locator", () => {
    const plan = resumePlan(null, {
      location: "ch.xhtml?p=0.5",
      anchor: { quote: "Call me", prefix: "pre", suffix: "post" },
    });
    expect(plan.kind).toBe("override-locator");
    if (plan.kind === "override-locator") {
      expect(plan.locator).toContain("ch.xhtml?p=0.5");
      expect(plan.locator).toContain("q=Call");
      expect(plan.locator).toContain("b=pre");
      expect(plan.locator).toContain("a=post");
    }
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
    // R11: hours carry a minute part ("1 h 25 min left").
    expect(formatTimeLeft(85)).toBe("≈ 1 h 25 min left");
    expect(formatTimeLeft(120)).toBe("≈ 2 h left");
    expect(formatTimeLeft(119.6)).toBe("≈ 2 h left");
  });

  it("minutesForFraction scales the observed pace onto a book fraction", () => {
    const pace = new ReadingPaceStats({ sessionsMs: 60_000, percentRead: 50 });
    // 1 minute spent per 50% → 0.1 of the book costs 0.2 minutes.
    expect(pace.minutesForFraction(0.1)).toBeCloseTo(0.2, 5);
    expect(pace.minutesForFraction(0)).toBeNull();
    // No observed pace yet — nothing to extrapolate from.
    expect(new ReadingPaceStats(null).minutesForFraction(0.5)).toBeNull();
  });

  it("formatChapterTimeLeft hides sub-minute estimates (R11)", () => {
    expect(formatChapterTimeLeft(null)).toBeNull();
    expect(formatChapterTimeLeft(0.4)).toBeNull();
    expect(formatChapterTimeLeft(12.4)).toBe("≈ 12 min left in chapter");
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
    const writer = new ProgressWriter(
      async () => {
        written += 1;
      },
      () => now,
    );
    await writer.onLocator({ location: "a", percent: 10 });
    now = 1100;
    const ok = await writer.onLocator({ location: "a", percent: 10.1 });
    expect(ok).toBe(false);
    expect(written).toBe(1);
  });

  it("writes when location changes after 500 ms", async () => {
    let written = 0;
    let now = 1000;
    const writer = new ProgressWriter(
      async () => {
        written += 1;
      },
      () => now,
    );
    await writer.onLocator({ location: "a", percent: 10 });
    now = 1600;
    const ok = await writer.onLocator({ location: "b", percent: 10.1 });
    expect(ok).toBe(true);
    expect(written).toBe(2);
  });

  it("flush writes the pending snapshot", async () => {
    let written = 0;
    let now = 1000;
    const writer = new ProgressWriter(
      async () => {
        written += 1;
      },
      () => now,
    );
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
    const writer = new ProgressWriter(
      async () => {
        written += 1;
      },
      () => now,
    );
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
    const writer = new ProgressWriter(
      async () => {
        written += 1;
      },
      () => now,
    );
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
    const now = 0;
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
    const now = 0;
    const chrome = new ChromeStateMachine(() => now);
    chrome.toggle();
    expect(chrome.visible).toBe(false);
    chrome.toggle();
    expect(chrome.visible).toBe(true);
  });

  it("zone hit-testing: narrow edges page, the reading column passes through", () => {
    const width = 1000;
    expect(readerEdgeZoneWidth(width)).toBe(80);
    expect(readerEdgeZoneWidth(100)).toBe(48); // clamped for narrow windows
    expect(readerEdgeZoneWidth(4000)).toBe(96); // clamped for wide windows
    const base = { width, interactive: false, defaultPrevented: false };
    expect(intentForReaderClick({ ...base, x: 20 })).toBe("previous");
    expect(intentForReaderClick({ ...base, x: 500 })).toBe("passthrough");
    expect(intentForReaderClick({ ...base, x: 980 })).toBe("next");
  });

  it("interactive and engine-handled clicks always pass through", () => {
    const width = 1000;
    expect(intentForReaderClick({ x: 5, width, interactive: true, defaultPrevented: false })).toBe(
      "passthrough",
    );
    expect(
      intentForReaderClick({ x: 995, width, interactive: false, defaultPrevented: true }),
    ).toBe("passthrough");
    expect(intentForReaderClick({ x: 5, width, interactive: true, defaultPrevented: true })).toBe(
      "passthrough",
    );
  });

  it("a hold keeps the chrome up past the idle window", () => {
    let now = 0;
    const chrome = new ChromeStateMachine(() => now);
    chrome.hold("panel");
    now = 10_000;
    expect(chrome.tick()).toBe("visible");
    expect(chrome.held).toBe(true);

    chrome.release("panel");
    now = 11_000;
    expect(chrome.tick()).toBe("visible"); // countdown restarts on release
    now = 14_500;
    expect(chrome.tick()).toBe("hidden");
  });

  it("holds are idempotent per reason", () => {
    let now = 0;
    const chrome = new ChromeStateMachine(() => now);
    chrome.hold("menu");
    chrome.hold("menu");
    chrome.release("menu");
    now = 3500;
    expect(chrome.tick()).toBe("hidden");
  });

  it("toggle refuses to hide the controls under an open panel", () => {
    const chrome = new ChromeStateMachine(() => 0);
    chrome.hold("panel");
    expect(chrome.toggle()).toBe("visible");
    expect(chrome.visible).toBe(true);
  });

  it("pillar hover holds for 3 s even at rest (07 §2)", () => {
    let now = 0;
    const chrome = new ChromeStateMachine(() => now);
    // A resting cursor: no onActivity after the hover begins.
    chrome.onActivity();
    now = 1000;
    chrome.onPillarHover();
    now = 3500; // beyond the 3 s idle window
    expect(chrome.tick()).toBe("visible"); // within the 3 s hover grace
    now = 4200; // hover started at 1000 + 3000
    expect(chrome.tick()).toBe("hidden");
  });

  it("pillar hover grace clears on normal activity, toggle, and beyond", () => {
    let now = 0;
    const chrome = new ChromeStateMachine(() => now);
    chrome.onPillarHover();
    now = 500;
    chrome.onActivity(); // moving elsewhere leaves idle scheduling
    now = 3400;
    expect(chrome.tick()).toBe("visible"); // idle rescheduled at 500
    now = 4000;
    expect(chrome.tick()).toBe("hidden");

    const chrome2 = new ChromeStateMachine(() => now);
    chrome2.toggle(); // user-hidden chrome is still revealed by the hover zone
    chrome2.onPillarHover();
    now = 5000;
    expect(chrome2.tick()).toBe("visible"); // hover reveal wins over toggle
    now = 8600; // 5000 + 3000 grace + tick margin
    expect(chrome2.tick()).toBe("hidden");
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
      theme,
    );
    expect(mapped.fontSize).toBeCloseTo(18 / 16);
    expect(mapped.scroll).toBe(true);
    expect(mapped.textAlign).toBe("justify");
    expect(mapped.columnCount).toBe(1); // scrolled is always single-column
  });

  it("F9 5.2a: EPUB column count follows the spread pref and viewport", () => {
    const paginated = { ...DEFAULT_READING_PREFS, flow: "paginated" as const };
    const scrolled = { ...DEFAULT_READING_PREFS, flow: "scrolled" as const };

    // scrolled flow spreads nothing, even with the spread pref on "both"
    expect(resolveEpubColumnCount({ ...scrolled, spread: "both" }, 1920)).toBe(1);
    // "both" forces two columns on any width
    expect(resolveEpubColumnCount({ ...paginated, spread: "both" }, 800)).toBe(2);
    // "none" leaves the toolkit default in place (undefined)
    expect(resolveEpubColumnCount({ ...paginated, spread: "none" }, 1920)).toBeUndefined();
    // "auto" mirrors PDF's landscape rule: two columns only when wide
    expect(
      resolveEpubColumnCount({ ...paginated, spread: "auto" }, EPUB_SPREAD_MIN_WIDTH - 1),
    ).toBe(1);
    expect(resolveEpubColumnCount({ ...paginated, spread: "auto" }, EPUB_SPREAD_MIN_WIDTH)).toBe(2);
    // the mapping carries it into the navigator prefs (jsdom width 1024)
    const theme = resolveReaderTheme("light", false);
    expect(toNavigatorPreferences({ ...paginated, spread: "auto" }, theme).columnCount).toBe(1);
    expect(toNavigatorPreferences({ ...paginated, spread: "both" }, theme).columnCount).toBe(2);
  });
});

describe("ReadiumEngine search and lifecycle", () => {
  it("F9 5.2a: window resize re-applies prefs for paginated auto spread, and only then", async () => {
    const auto = { ...DEFAULT_READING_PREFS, flow: "paginated" as const, spread: "auto" as const };
    const engine = createReadiumEngine({ epubBytes: new Uint8Array(0), prefs: auto });
    const spy = vi.spyOn(engine, "applyPrefs").mockResolvedValue(undefined);
    window.dispatchEvent(new Event("resize"));
    expect(spy).toHaveBeenCalledTimes(1);

    // destroy removes the listener
    await engine.destroy();
    spy.mockClear();
    window.dispatchEvent(new Event("resize"));
    expect(spy).not.toHaveBeenCalled();

    // scrolled flow never needs a re-apply (column count is width-independent)
    const scrolledEngine = createReadiumEngine({
      epubBytes: new Uint8Array(0),
      prefs: { ...auto, flow: "scrolled" },
    });
    const scrolledSpy = vi.spyOn(scrolledEngine, "applyPrefs").mockResolvedValue(undefined);
    window.dispatchEvent(new Event("resize"));
    expect(scrolledSpy).not.toHaveBeenCalled();
    await scrolledEngine.destroy();
  });

  it("reuses cached search index across successive searches and clears on destroy", async () => {
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
    const epubBytes = makeEpub("SearchTest", [
      { id: "c1", title: "Chapter 1", body: "The quick brown fox jumps over the lazy dog." },
      { id: "c2", title: "Chapter 2", body: "Another chapter with some unique query content." },
    ]);
    const engine = createReadiumEngine({
      epubBytes,
      prefs: DEFAULT_READING_PREFS,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await engine.open(container);

    const hits1 = await engine.search("quick");
    expect(hits1.length).toBe(1);
    expect(hits1[0].chapterTitle).toBe("OEBPS/c1.xhtml");

    // Second search reuses cached index
    const hits2 = await engine.search("unique");
    expect(hits2.length).toBe(1);
    expect(hits2[0].chapterTitle).toBe("OEBPS/c2.xhtml");

    // Destroy clears resources and returns empty on search
    await engine.destroy();
    const hitsAfterDestroy = await engine.search("quick");
    expect(hitsAfterDestroy).toEqual([]);
    document.body.removeChild(container);
  });

  it("retries a failed search index instead of caching the rejection", async () => {
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
    const epubBytes = makeEpub("RetrySearch", [
      { id: "c1", title: "Chapter 1", body: "The quick brown fox jumps." },
    ]);
    const engine = createReadiumEngine({
      epubBytes,
      prefs: DEFAULT_READING_PREFS,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await engine.open(container);

    const pub = (engine as unknown as { pub: { readingOrder: unknown } }).pub;
    const realReadingOrder = pub.readingOrder;
    let failedOnce = false;
    Object.defineProperty(pub, "readingOrder", {
      configurable: true,
      get() {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error("transient index failure");
        }
        return realReadingOrder;
      },
    });

    await expect(engine.search("quick")).rejects.toThrow("transient index failure");
    const hits = await engine.search("quick");
    expect(hits).toHaveLength(1);
    expect(hits[0].chapterTitle).toBe("OEBPS/c1.xhtml");

    await engine.destroy();
    document.body.removeChild(container);
  });

  it("re-submits prefs with resolved colours when the OS dark flag flips (R9)", async () => {
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
    const epubBytes = makeEpub("SystemTheme", [
      { id: "c1", title: "Chapter 1", body: "Theme flip test." },
    ]);
    const engine = createReadiumEngine({
      epubBytes,
      prefs: { ...DEFAULT_READING_PREFS, theme: "system" },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await engine.open(container);

    const internals = engine as unknown as {
      navigator: { submitPreferences: (p: unknown) => Promise<void> } | null;
      systemDark: boolean;
    };
    const submit = vi.spyOn(internals.navigator!, "submitPreferences");
    const backgrounds = () =>
      submit.mock.calls.map((call) => (call[0] as { backgroundColor: string }).backgroundColor);
    const dark = internals.systemDark;
    const count = submit.mock.calls.length;

    // Flipping the OS flag re-submits prefs with the other system palette.
    await engine.setSystemDark(!dark);
    expect(submit.mock.calls.length).toBe(count + 1);
    expect(backgrounds()[backgrounds().length - 1]).not.toBe(backgrounds()[count - 1]);

    // Same flag again: the guard skips the redundant re-submit.
    await engine.setSystemDark(!dark);
    expect(submit.mock.calls.length).toBe(count + 1);

    // Flipping back works too.
    await engine.setSystemDark(dark);
    expect(submit.mock.calls.length).toBe(count + 2);

    await engine.destroy();
    document.body.removeChild(container);
  });

  it("reports chapter start marks from the positions list (R11)", async () => {
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
    const epubBytes = makeEpub("ChapterMarks", [
      {
        id: "c1",
        title: "Chapter 1",
        body: "First chapter with a fair amount of text to read through slowly.",
      },
      {
        id: "c2",
        title: "Chapter 2",
        body: "Second chapter also carrying some body text of its own.",
      },
    ]);
    const engine = createReadiumEngine({ epubBytes, prefs: DEFAULT_READING_PREFS });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await engine.open(container);

    const marks = engine.chapterMarks();
    // One mark per spine resource, in reading order, first at 0.
    expect(marks.length).toBe(2);
    expect(marks[0].percent).toBe(0);
    expect(marks[1].percent).toBeGreaterThan(0);
    // Cached: a second call returns the same list.
    expect(engine.chapterMarks()).toBe(marks);

    await engine.destroy();
    document.body.removeChild(container);
  });
});
