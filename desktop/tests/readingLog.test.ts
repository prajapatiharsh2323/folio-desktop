// F2 (Phase 5): Insights — reading-log repo IO, streak/window math, and the
// Insights screen render. The jsdom env has no usable localStorage, so
// `../src/lib/storage` is mocked with a hoisted Map (project test-harness rule).
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import { ReadingLogRepo, type ReadingLogFile } from "../src/store/repos";
import {
  currentStreak,
  dateKeyOf,
  formatMinutes,
  previousDayKey,
  sumRange,
  topBooks,
  windowKeys,
} from "../src/lib/readingLog";
import type { Progress } from "../src/model/types";

// ---- date helpers -----------------------------------------------------------

describe("reading-log date keys", () => {
  it("dateKeyOf uses the local calendar day", () => {
    expect(dateKeyOf(new Date(2026, 10, 17, 23, 59))).toBe("2026-11-17");
    expect(dateKeyOf(new Date(2026, 0, 3, 0, 0))).toBe("2026-01-03");
  });

  it("previousDayKey walks across month and year boundaries", () => {
    expect(previousDayKey("2026-03-01")).toBe("2026-02-28");
    expect(previousDayKey("2026-01-01")).toBe("2025-12-31");
    expect(previousDayKey("2026-11-17")).toBe("2026-11-16");
  });

  it("windowKeys ends on today and spans n days", () => {
    const w = windowKeys("2026-11-17", 7);
    expect(w.to).toBe("2026-11-17");
    expect(w.from).toBe("2026-11-11");
    expect(windowKeys("2026-11-17", 30).from).toBe("2026-10-19");
  });
});

// ---- streak + window sums ---------------------------------------------------

function daysOf(map: Record<string, number>): ReadingLogFile["days"] {
  return Object.fromEntries(Object.entries(map).map(([k, ms]) => [k, { ms }]));
}

describe("currentStreak and sumRange", () => {
  const today = "2026-11-17";

  it("counts consecutive days ≥1 min ending today", () => {
    const days = daysOf({ "2026-11-17": 90_000, "2026-11-16": 60_000, "2026-11-15": 120_000 });
    expect(currentStreak(days, today)).toBe(3);
  });

  it("a sub-minute day is not counted but doesn't break yesterday's streak", () => {
    const days = daysOf({ "2026-11-17": 30_000, "2026-11-16": 60_000 });
    expect(currentStreak(days, today)).toBe(1);
  });

  it("counts from yesterday when today has no reading yet", () => {
    const days = daysOf({ "2026-11-16": 60_000, "2026-11-15": 60_000 });
    expect(currentStreak(days, today)).toBe(2);
  });

  it("an empty log has no streak", () => {
    expect(currentStreak({}, today)).toBe(0);
  });

  it("sumRange is inclusive over the window", () => {
    const days = daysOf({ "2026-11-10": 1000, "2026-11-11": 2000, "2026-11-17": 3000 });
    expect(sumRange(days, "2026-11-11", "2026-11-17")).toBe(5000);
  });
});

// ---- top books + formatting --------------------------------------------------

function progress(docId: string, sessionsMs: number, percent = 42): Progress {
  return {
    docId,
    location: "x",
    percent,
    updatedAt: "2026-11-17T00:00:00.000Z",
    pace: { sessionsMs, percentRead: percent },
  };
}

describe("topBooks", () => {
  it("ranks by all-time time, joins titles, and caps the list", () => {
    const rows = topBooks(
      { a: progress("a", 5_000_000), b: progress("b", 9_000_000), c: progress("c", 0) },
      (id) => `Title ${id}`,
      2,
    );
    expect(rows.map((r) => [r.docId, r.title, r.ms])).toEqual([
      ["b", "Title b", 9_000_000],
      ["a", "Title a", 5_000_000],
    ]);
    expect(rows[0].percent).toBe(42);
  });

  it("falls back to the generic title for docs missing from the manifest", () => {
    const rows = topBooks({ z: progress("z", 1000) }, () => "Unknown title");
    expect(rows[0].title).toBe("Unknown title");
  });
});

describe("formatMinutes", () => {
  it("formats minutes, hours and mixed", () => {
    expect(formatMinutes(30_000)).toBe("<1 min");
    expect(formatMinutes(5 * 60_000)).toBe("5 min");
    expect(formatMinutes(60 * 60_000)).toBe("1 hr");
    expect(formatMinutes(83 * 60_000)).toBe("1 hr 23 min");
  });
});

// ---- ReadingLogRepo IO ------------------------------------------------------

describe("ReadingLogRepo", () => {
  let fs: MemoryFileStore;
  let repo: ReadingLogRepo;

  beforeEach(() => {
    fs = new MemoryFileStore();
    repo = new ReadingLogRepo(fs, "/lib");
  });

  it("accumulates per day and per doc", async () => {
    await repo.addMs("2026-11-17", "d1", 60_000);
    await repo.addMs("2026-11-17", "d1", 30_000);
    await repo.addMs("2026-11-17", "d2", 15_000);
    await repo.addMs("2026-11-18", "d1", 10_000);
    const log = await repo.all();
    expect(log.schema).toBe(1);
    expect(log.days["2026-11-17"]).toEqual({
      ms: 105_000,
      perDoc: { d1: 90_000, d2: 15_000 },
    });
    expect(log.days["2026-11-18"]).toEqual({ ms: 10_000, perDoc: { d1: 10_000 } });
  });

  it("ignores non-positive deltas", async () => {
    await repo.addMs("2026-11-17", "d1", 0);
    await repo.addMs("2026-11-17", "d1", -5);
    expect((await repo.all()).days).toEqual({});
  });

  it("preserves unknown keys of the file and of day records", async () => {
    await fs.writeTextAtomic(
      "/lib/user/reading-log.json",
      JSON.stringify({
        customTop: "keep me",
        days: { "2026-11-17": { ms: 1000, customDay: 7, perDoc: { d1: 1000 } } },
      }),
    );
    await repo.addMs("2026-11-17", "d1", 500);
    const raw = JSON.parse(await fs.readText("/lib/user/reading-log.json"));
    expect(raw.customTop).toBe("keep me");
    expect(raw.days["2026-11-17"].customDay).toBe(7);
    expect(raw.days["2026-11-17"].ms).toBe(1500);
    expect(raw.days["2026-11-17"].perDoc.d1).toBe(1500);
  });

  it("removeDoc trims perDoc buckets and drops empty ones, keeping totals", async () => {
    await repo.addMs("2026-11-17", "d1", 60_000);
    await repo.addMs("2026-11-17", "d2", 30_000);
    await repo.removeDoc("d1");
    const log = await repo.all();
    expect(log.days["2026-11-17"].ms).toBe(90_000);
    expect(log.days["2026-11-17"].perDoc).toEqual({ d2: 30_000 });
    // d2 alone: perDoc survives; a doc-less day would keep only ms
    await repo.removeDoc("d2");
    expect((await repo.all()).days["2026-11-17"]).toEqual({ ms: 90_000 });
  });

  it("reading-log.json backs up with the rest of user/**", async () => {
    const { classifyArchivePath } = await import("../src/backup/backupPaths");
    expect(classifyArchivePath("user/reading-log.json")).toBe("library");
  });
});
