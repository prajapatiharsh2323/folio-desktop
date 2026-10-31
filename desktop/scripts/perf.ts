// FT-005 perf harness (04 §12). Runs the parts of the budgets that are
// measurable without the Tauri webview, prints machine-readable JSON, and
// marks each budget with its scope. The full budget verdicts still require a
// real Windows app run — see
// docs/development/audits/results/R-20261031-02-performance-method.md.
//
// Run:  cd desktop && node --experimental-transform-types --import ./scripts/perf-register.mjs scripts/perf.ts
// (`--experimental-transform-types` is required for parameter properties in
// the app sources; plain strip-only mode cannot run epubPublication.ts.)
import { JSDOM } from "jsdom";
import os from "node:os";

// openEpubFromBytes / parseEpub / locatorCodec need a DOMParser; provide the
// jsdom one (slower than Chromium's — see the method doc for the caveat).
const dom = new JSDOM();
(globalThis as Record<string, unknown>).DOMParser = dom.window.DOMParser;

const { parseEpub } = await import("../src/import/epubImporter.ts");
const { sha256Hex } = await import("../src/lib/sha256.ts");
const { decodeLocation, encodeLocation } = await import("../src/reader/locatorCodec.ts");
const { openEpubFromBytes } = await import("../src/reader/epubPublication.ts");
const { buildSyntheticEpub } = await import("../src/perf/synthEpub.ts");

const CHAPTERS = 24;
const SIZE_TARGET = 3 * 1024 * 1024; // 3 MB compressed, the budget's reference size

/** Median of `runs` timed samples after `warmups` discarded runs (ms). */
function bench(name: string, fn: () => void | Promise<void>, runs = 7, warmups = 2) {
  return {
    name,
    samples: [] as number[][],
    async run() {
      for (let i = 0; i < warmups; i++) await fn();
      const samples: number[] = [];
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        await fn();
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      this.samples.push(samples);
      return samples[Math.floor(runs / 2)];
    },
  };
}

const epub = buildSyntheticEpub(SIZE_TARGET, CHAPTERS);
const sizeMiB = epub.length / (1024 * 1024);

// 200 annotation locators ≈ the heaviest decoration batch (04 §12 case 3).
const fixtureLocators = Array.from({ length: 200 }, (_, i) =>
  encodeLocation({
    href: `Text/ch${(i % CHAPTERS) + 1}.xhtml#frag${i}`,
    progression: (i % 100) / 100,
    anchor: { quote: `quote text ${i}`, prefix: `...prefix ${i}`, suffix: `suffix ${i}` },
  })
);

const benches = [
  {
    id: "reader_parse_openEpubFromBytes",
    scope: "04 §12 budget 1 factor — 'parser' of cold open (zip + container/OPF + manifest → Readium Publication). Webview init/rendering excluded.",
    limitMs: 1_200,
    runs: 5,
    fn: () => {
      const pkg = openEpubFromBytes(epub);
      // positions are derived from the full spine — a strong witness that
      // container/OPF/manifest parsing completed.
      if (!pkg.positions?.length) throw new Error("pkg missing positions");
      if (pkg.positions.length < CHAPTERS) throw new Error("too few positions");
    },
  },
  {
    id: "import_parseEpub",
    scope: "Import-path parse (zip + OPF + spine HTML → sanitized text). A distinct user flow ('Add book'), recorded for comparison; not the 1.2 s budget itself.",
    limitMs: null,
    runs: 5,
    fn: () => {
      const r = parseEpub(epub);
      if (r.chapters.length !== CHAPTERS) throw new Error("fixture mismatch");
    },
  },
  {
    id: "import_digest_sha256",
    scope: "Content digest persisted on import; informative cold-open component.",
    limitMs: null,
    runs: 7,
    fn: async () => {
      const d = await sha256Hex(epub);
      if (!/^[0-9a-f]{64}$/.test(d)) throw new Error("digest mismatch");
    },
  },
  {
    id: "locator_decode_200",
    scope: "Pure locator decode cost of a 200-highlight batch (input side of 04 §12 budget 3). Paint cost excluded — needs the webview.",
    limitMs: 400,
    runs: 9,
    fn: () => {
      let ok = 0;
      for (const raw of fixtureLocators) {
        const loc = decodeLocation(raw);
        if (loc && loc.href) ok++;
      }
      if (ok !== 200) throw new Error("decode mismatch");
    },
  },
];

const results: Array<Record<string, unknown>> = [];
for (const item of benches) {
  const b = bench(item.id, item.fn, item.runs, item.runs > 5 ? 1 : 2);
  const median = await b.run();
  const trim = (v: number) => Math.round(v * 100) / 100;
  results.push({
    id: item.id,
    runs: item.runs,
    samplesMs: (b.samples[0] ?? []).map(trim),
    medianMs: trim(median),
    budget: {
      limitMs: item.limitMs,
      withinBudget: item.limitMs === null ? null : median <= item.limitMs,
      scope: item.scope,
    },
  });
}

const report = {
  harness: "desktop/scripts/perf.ts",
  date: new Date().toISOString(),
  environment: {
    runtime: `node ${process.versions.node}`,
    platform: `${process.platform}/${process.arch}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.cpus().length,
    domParser: "jsdom (slower than Chromium; numbers are a conservative baseline, not the runtime verdict)",
  },
  fixture: {
    epubSizeBytes: epub.length,
    epubSizeMiB: Math.round(sizeMiB * 100) / 100,
    chapters: CHAPTERS,
  },
  results,
};

console.log(JSON.stringify(report, null, 2));
