// Baseline import snapshots (PDF plan Phase 0 step 1): before the shared
// buildMetaFiles/filesMapFor refactor, pin exactly what EPUB/HTML/TXT imports
// write to disk — file paths, bytes and meta.json (unstable fields masked).
// The refactor must keep these identical; the later PDF branch adds cases
// beside them without touching these.
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import { LibraryManager } from "../src/store/libraryManager";
import { importFile } from "../src/import/importService";
import { buildMetaFiles, filesMapFor, type PipelineResult } from "../src/import/importService";
import { strToU8, zipSync, type Zippable } from "fflate";
import type { DocMeta } from "../src/model/types";

const ROOT = "/lib";
let fs: MemoryFileStore;
let lm: LibraryManager;

beforeEach(() => {
  fs = new MemoryFileStore();
  lm = new LibraryManager(fs, ROOT);
});

const TE = new TextEncoder();

/** Replace import-random fields so meta.json becomes comparable: the uuid,
 *  timestamps and the fflate-written zip timestamps behind contentHash. */
function normaliseMeta(raw: string): string {
  const meta = JSON.parse(raw) as Record<string, unknown>;
  meta.id = "<id>";
  meta.capturedAt = "<ts>";
  meta.importedAt = "<ts>";
  meta.contentHash = "<hash>";
  return JSON.stringify(meta);
}

describe("baseline: TXT import snapshot", () => {
  it("writes exactly original/… + reading/book.epub + clean tree and stable meta", async () => {
    const text = "Chapter one.\n\nHello world, this is a plain text book for the baseline.";
    const result = await importFile(lm, "notes.txt", TE.encode(text));
    expect(result.status).toBe("imported");

    const manifest = await lm.load();
    const entry = manifest!.docs[0];
    const meta: DocMeta = (await lm.meta.read(entry.slug))!;
    expect(normaliseMeta(JSON.stringify(meta))).toMatchSnapshot();

    // meta.files.cover stays null for TXT and TXT produces no clean HTML —
    // only original + reading are written.
    expect(meta.files.cover).toBeNull();
    expect(meta.files.clean).toBeNull();

    // Reading bytes exist and are a non-empty EPUB (built file).
    const reading = await fs.readBytes(`${ROOT}/docs/${entry.slug}/reading/book.epub`);
    expect(reading[0]).toBe(0x50); // "PK" zip magic
    expect(reading.length).toBeGreaterThan(100);
  });
});

describe("baseline: HTML import snapshot", () => {
  it("writes original/page.html + clean tree and stable meta", async () => {
    const html = `<!doctype html><html><head><title>Baseline Article</title></head><body><article><h1>Heading</h1><p>Paragraph one with words.</p><p>Paragraph two with more words.</p></article></body></html>`;
    const result = await importFile(lm, "page.html", TE.encode(html));
    expect(result.status).toBe("imported");

    const manifest = await lm.load();
    const entry = manifest!.docs[0];
    const meta = (await lm.meta.read(entry.slug))!;
    expect(normaliseMeta(JSON.stringify(meta))).toMatchSnapshot();
    expect(meta.files).toMatchInlineSnapshot(`
      {
        "clean": "clean/index.html",
        "cover": null,
        "original": "original/page.html",
        "reading": "reading/book.epub",
      }
    `);
  });
});

describe("baseline: EPUB import snapshot", () => {
  it("writes original/book.epub + reading/book.epub and stable meta", async () => {
    const bytes = zipSync({
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": [
        strToU8(
          `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
        ),
        {},
      ],
      "OEBPS/content.opf": [
        strToU8(
          `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:x</dc:identifier><dc:title>Baseline Book</dc:title><dc:creator>A. Writer</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2025-01-01T00:00:00Z</meta></metadata><manifest/><spine/></package>`,
        ),
        {},
      ],
    } as Zippable);
    const result = await importFile(lm, "book.epub", bytes);
    expect(result.status).toBe("imported");

    const manifest = await lm.load();
    const entry = manifest!.docs[0];
    const meta = (await lm.meta.read(entry.slug))!;
    expect(normaliseMeta(JSON.stringify(meta))).toMatchSnapshot();
    expect(meta.files).toMatchInlineSnapshot(`
      {
        "clean": null,
        "cover": null,
        "original": "original/book.epub",
        "reading": "reading/book.epub",
      }
    `);
  });
});

describe("baseline: buildMetaFiles/filesMapFor unit contract", () => {
  it("matches the pre-refactor inline shape for EPUB", () => {
    const p: PipelineResult = {
      title: "T",
      author: null,
      kind: "book",
      language: "en",
      sourceFormat: "epub",
      chapters: [],
      readingPath: "reading/book.epub",
      readingBytes: TE.encode("reading-bytes"),
      originalName: "book.epub",
      originalBytes: TE.encode("original-bytes"),
      cleanHtml: null,
      imageFiles: {},
      cover: { name: "cover.jpg", bytes: TE.encode("cover-bytes") },
      wordCount: null,
      searchable: true,
      chapterTexts: [],
    };
    expect(buildMetaFiles(p)).toEqual({
      original: "original/book.epub",
      clean: null,
      reading: "reading/book.epub",
      cover: "cover.jpg",
    });
    const map = filesMapFor(p);
    expect(Object.keys(map)).toEqual(["original/book.epub", "reading/book.epub", "cover.jpg"]);
    expect(new TextDecoder().decode(map["reading/book.epub"])).toBe("reading-bytes");
    expect(new TextDecoder().decode(map["original/book.epub"])).toBe("original-bytes");
    expect(new TextDecoder().decode(map["cover.jpg"])).toBe("cover-bytes");
  });

  it("writes clean/index.html only when cleanHtml exists (HTML/TXT path)", () => {
    const p: PipelineResult = {
      title: "T",
      author: null,
      kind: "article",
      language: "en",
      sourceFormat: "html",
      chapters: [],
      readingPath: "reading/book.epub",
      readingBytes: TE.encode("reading"),
      originalName: "page.html",
      originalBytes: TE.encode("original"),
      cleanHtml: "<html></html>",
      imageFiles: { "clean/images/img1.png": TE.encode("img") },
      cover: null,
      wordCount: 3,
      searchable: true,
      chapterTexts: [],
    };
    expect(buildMetaFiles(p)).toEqual({
      original: "original/page.html",
      clean: "clean/index.html",
      reading: "reading/book.epub",
      cover: null,
    });
    expect(Object.keys(filesMapFor(p))).toEqual([
      "original/page.html",
      "reading/book.epub",
      "clean/index.html",
      "clean/images/img1.png",
    ]);
  });
});
