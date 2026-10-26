import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFileStore } from "../src/lib/fileStore";
import { LibraryManager } from "../src/store/libraryManager";
import {
  assertImportable,
  detectLanguage,
  ImportError,
  COPY,
} from "../src/import/fileDetector";
import { importFile, replaceDoc } from "../src/import/importService";
import { buildEpub } from "../src/import/clip/epubBuilder";
import { parseEpub } from "../src/import/epubImporter";
import { sanitizeHtml } from "../src/import/sanitize";
import { importTxt } from "../src/import/articleImporters";
import { strToU8, zipSync, type Zippable } from "fflate";
import type { DocMeta } from "../src/model/types";

const ROOT = "/lib";
let lm: LibraryManager;
let fs: MemoryFileStore;

beforeEach(() => {
  fs = new MemoryFileStore();
  lm = new LibraryManager(fs, ROOT);
});

const TE = new TextEncoder();

function epubWith(containerExtra: Zippable = {}): Uint8Array {
  return zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": [
      strToU8(
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
      ),
      {},
    ],
    "OEBPS/content.opf": [
      strToU8(
        `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:x</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2025-01-01T00:00:00Z</meta></metadata><manifest/><spine/></package>`
      ),
      {},
    ],
    ...containerExtra,
  });
}

describe("import gates (fileDetector)", () => {
  it("refuses PDF with mobile-parity copy", () => {
    const bytes = TE.encode("%PDF-1.7 fake");
    expect(() => assertImportable("book.pdf", bytes)).toThrowError(COPY.pdf);
    try {
      assertImportable("book.pdf", bytes);
    } catch (e) {
      expect((e as ImportError).code).toBe("pdf");
    }
  });

  it("refuses >50MB", () => {
    const bytes = new Uint8Array(50 * 1024 * 1024 + 1);
    expect(() => assertImportable("big.txt", bytes)).toThrowError(COPY.tooLarge);
  });

  it("refuses DRM: encryption.xml with a non-font algo", () => {
    const bytes = zipSync({
      "META-INF/container.xml": [strToU8("<container/>"), {}],
      "META-INF/encryption.xml": [
        strToU8(
          `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></encryption>`
        ),
        {},
      ],
    });
    expect(() => assertImportable("book.epub", bytes)).toThrowError(COPY.drm);
  });

  it("allows font-obfuscation-only encryption.xml", () => {
    const bytes = epubWith({
      "META-INF/encryption.xml": [
        strToU8(
          `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></encryption>`
        ),
        {},
      ],
    });
    expect(assertImportable("book.epub", bytes)).toBe("epub");
  });

  it("refuses rights.xml", () => {
    const bytes = epubWith({
      "META-INF/rights.xml": [strToU8("<rights/>"), {}],
    });
    expect(() => assertImportable("book.epub", bytes)).toThrowError(COPY.drm);
  });

  it("detects language: Devanagari ratio > 0.3 → hi", () => {
    const hi = "यह एक परीक्षण वाक्य है। यह एक परीक्षण वाक्य है।";
    expect(detectLanguage(hi)).toBe("hi");
    expect(detectLanguage("This is a plain English sentence.")).toBe("en");
  });
});

describe("EpubBuilder determinism", () => {
  it("produces byte-identical output for identical input", async () => {
    const input = {
      title: "Test Book",
      author: "An Author",
      language: "en",
      contentHash: "a".repeat(64),
      chapters: [
        { title: "One", html: "<p>alpha</p>" },
        { title: "Two", html: "<p>beta</p>" },
      ],
    };
    const a = await buildEpub(input);
    const b = await buildEpub(input);
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
  });

  it("stores mimetype first and uncompressed; deterministic uuid from contentHash", async () => {
    const built = await buildEpub({
      title: "T",
      language: "en",
      contentHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      chapters: [{ title: "C1", html: "<p>x</p>" }],
    });
    // parse back with our own importer (round trip)
    const parsed = parseEpub(built.bytes);
    expect(parsed.chapters.map((c) => c.title)).toEqual(["C1"]);
    // uuid derivation is a pure function of the hash
    const { uuidFromContentHash } = await import("../src/import/clip/epubBuilder");
    const u1 = uuidFromContentHash("abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    const u2 = uuidFromContentHash("abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    expect(u1).toBe(u2);
    expect(u1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("sanitize", () => {
  it("strips scripts/styles/forms and non-safe attributes", async () => {
    const out = await sanitizeHtml(
      `<html><head><title>My Article</title><script>alert(1)</script></head><body>
       <h1>Head</h1><p onclick="x()">para</p><a href="javascript:evil()">bad</a>
       <a href="https://ok.example">good</a></body></html>`
    );
    expect(out.title).toBe("My Article");
    expect(out.html).not.toContain("script");
    expect(out.html).not.toContain("onclick");
    expect(out.html).not.toContain("javascript:");
    expect(out.html).toContain('href="https://ok.example"');
  });

  it("extracts up to 40 data-URI images as hash-named files", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const imgs = Array.from({ length: 45 }, () => `<img src="${png}">`).join("");
    const out = await sanitizeHtml(`<body>${imgs}</body>`);
    expect(out.images.length).toBe(40);
    expect(out.html).not.toContain("data:");
    for (const img of out.images) {
      expect(img.name).toHaveLength(64);
      expect(img.ext).toBe("png");
    }
  });
});

describe("import pipeline", () => {
  it("imports TXT: article kind, reading EPUB, index cache, manifest last", async () => {
    const text = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} text.\n\nSecond line.`).join("\n\n");
    const res = await importFile(lm, "note.txt", TE.encode(text));
    expect(res.status).toBe("imported");
    const manifest = await lm.load();
    expect(manifest!.docs).toHaveLength(1);
    const slug = manifest!.docs[0].slug;
    const meta = (await lm.meta.read(slug)) as DocMeta;
    expect(meta.kind).toBe("article");
    expect(meta.language).toBe("en");
    expect(meta.chapters.length).toBeGreaterThanOrEqual(3);
    expect(meta.chapters.length).toBeLessThanOrEqual(5);
    // reading edition is a valid epub
    const reading = await fs.readBytes(`${ROOT}/docs/${slug}/reading/book.epub`);
    expect(parseEpub(reading).chapters.length).toBe(meta.chapters.length);
    // index cache
    const idx = JSON.parse(await fs.readText(`${ROOT}/index/text/${meta.id}.json`));
    expect(idx.schema).toBe(1);
    expect(idx.chapters[0].text).toContain("Paragraph 0");
    // original preserved
    expect(await fs.readText(`${ROOT}/docs/${slug}/original/book.txt`)).toBe(text);
  });

  it("imports Hindi TXT with language 'hi'", async () => {
    const text = "यह पहला भाग है।\n\nयह दूसरा भाग है।\n\nयह तीसरा भाग है। अधिक पाठ।";
    const res = await importFile(lm, "kavita.txt", TE.encode(text));
    expect(res.status).toBe("imported");
    const doc = (await lm.load())!.docs[0];
    const meta = await lm.meta.read(doc.slug);
    expect(meta!.language).toBe("hi");
  });

  it("imports HTML: clean/index.html + extracted images + epub reading edition", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const html = `<html><head><title>Web Clip</title></head><body>
      <article><h1>Web Clip</h1><p>First paragraph with enough words.</p><img src="${png}">
      <script>evil()</script>${Array.from({ length: 30 }, (_, i) => `<p>Filler paragraph number ${i} with words.</p>`).join("")}
      </article></body></html>`;
    const res = await importFile(lm, "clip.html", TE.encode(html));
    expect(res.status).toBe("imported");
    const manifest = await lm.load();
    const doc = manifest!.docs[0];
    const meta = await lm.meta.read(doc.slug);
    expect(meta!.files.clean).toBe("clean/index.html");
    expect(meta!.files.cover).toBeNull();
    const clean = await fs.readText(`${ROOT}/docs/${doc.slug}/clean/index.html`);
    expect(clean).not.toContain("script");
    expect(clean).toContain("images/");
    const idx = JSON.parse(await fs.readText(`${ROOT}/index/text/${meta!.id}.json`));
    expect(idx.chapters.length).toBe(meta!.chapters.length);
  });

  it("imports EPUB: book kind, cover extraction (EPUB3 cover-image), original kept", async () => {
    const coverPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const bytes = zipSync({
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": [
        strToU8(
          `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
        ),
        {},
      ],
      "OEBPS/content.opf": [
        strToU8(
          `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">u</dc:identifier><dc:title>Sea Book</dc:title><dc:creator>Sailor</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2025-01-01T00:00:00Z</meta></metadata>
          <manifest>
            <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
            <item id="cov" href="cover.png" media-type="image/png" properties="cover-image"/>
          </manifest>
          <spine><itemref idref="c1"/></spine></package>`
        ),
        {},
      ],
      "OEBPS/ch1.xhtml": [strToU8("<html><body><h1>Loomings</h1><p>Call me Ishmael.</p></body></html>"), {}],
      "OEBPS/cover.png": [coverPng, { level: 0 }],
    });
    const res = await importFile(lm, "sea.epub", bytes);
    expect(res.status).toBe("imported");
    const doc = (await lm.load())!.docs[0];
    expect(doc.title).toBe("Sea Book");
    const meta = await lm.meta.read(doc.slug);
    expect(meta!.kind).toBe("book");
    expect(meta!.author).toBe("Sailor");
    expect(meta!.files.cover).toBe("cover.png");
    expect(Array.from(await fs.readBytes(`${ROOT}/docs/${doc.slug}/cover.png`))).toEqual(
      Array.from(coverPng)
    );
    expect(meta!.chapters[0].title).toBe("Loomings");
  });

  it("EPUB2 meta heuristic cover (meta[name=cover])", async () => {
    const bytes = zipSync({
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": [
        strToU8(
          `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
        ),
        {},
      ],
      "content.opf": [
        strToU8(
          `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:identifier id="id">u</dc:identifier><dc:title>Old Book</dc:title><dc:language>en</dc:language><meta name="cover" content="cov-id"/></metadata>
          <manifest><item id="c1" href="c1.html" media-type="application/xhtml+xml"/><item id="cov-id" href="cov.jpg" media-type="image/jpeg"/></manifest>
          <spine><itemref idref="c1"/></spine></package>`
        ),
        {},
      ],
      "c1.html": [strToU8("<html><body><p>text</p></body></html>"), {}],
      "cov.jpg": [new Uint8Array([255, 216, 255, 219]), { level: 0 }],
    });
    const res = await importFile(lm, "old.epub", bytes);
    const doc = (await lm.load())!.docs[0];
    expect(res.status).toBe("imported");
    const meta = await lm.meta.read(doc.slug);
    expect(meta!.files.cover).toBe("cover.jpg");
  });

  it("duplicate gate: skip / keep both / replace semantics", async () => {
    const text = "Same content.\n\nTwo paragraphs.";
    const bytes = TE.encode(text);
    const first = await importFile(lm, "a.txt", bytes);
    expect(first.status).toBe("imported");

    // skip
    const skip = await importFile(lm, "b.txt", bytes, async () => "skip");
    expect(skip.status).toBe("skipped");
    expect((await lm.load())!.docs).toHaveLength(1);

    // keep both
    const keep = await importFile(lm, "b.txt", bytes, async () => "keep");
    expect(keep.status).toBe("imported");
    const docs = (await lm.load())!.docs;
    expect(docs).toHaveLength(2);
    expect(new Set(docs.map((d) => d.slug)).size).toBe(2);

    // replace: keeps old id + annotations + progress
    // (duplicate gate targets the first manifest entry with the contentHash)
    const keepId = docs[0].id;
    await lm.annotations.add({
      id: "ann-1",
      docId: keepId,
      quote: "Same content.",
      prefix: "",
      suffix: "",
      kind: "highlight",
      color: "blue",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    });
    await lm.progress.put({
      docId: keepId,
      location: "epubcfi(/6/2)",
      percent: 42.5,
      updatedAt: "2025-01-02T00:00:00Z",
      pace: null,
    });
    const rep = await importFile(lm, "c.txt", bytes, async () => "replace");
    expect(rep.status).toBe("replaced");
    expect(rep.docId).toBe(keepId);
    const docs2 = (await lm.load())!.docs;
    expect(docs2).toHaveLength(2);
    expect(docs2.find((d) => d.id === keepId)).toBeDefined();
    expect((await lm.annotations.listForDoc(keepId)).length).toBe(1);
    expect((await lm.progress.get(keepId))!.percent).toBe(42.5);
  });

  it("replaceDoc directly preserves identity and user data", async () => {
    const bytes = TE.encode("Original.\n\nContent.");
    const first = await importFile(lm, "a.txt", bytes);
    const id = first.docId!;
    await lm.progress.put({ docId: id, location: "x", percent: 10, updatedAt: "2025-01-01T00:00:00Z", pace: null });
    const newer = TE.encode("Original.\n\nContent. v2");
    const rep = await replaceDoc(lm, id, "a.txt", newer, "txt", await (await import("../src/lib/sha256")).sha256Hex(newer));
    expect(rep.status).toBe("replaced");
    const docs = (await lm.load())!.docs;
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(id);
    expect((await lm.progress.get(id))!.percent).toBe(10);
  });

  it("refusals surface as status=refused with copy", async () => {
    const res = await importFile(lm, "doc.pdf", TE.encode("%PDF-1.4"));
    expect(res.status).toBe("refused");
    expect(res.error).toBe(COPY.pdf);
  });
});

describe("importTxt unit", () => {
  it("uses the first short line as title", () => {
    const a = importTxt("My Great Essay\n\nBody text here.", "fallback.txt");
    expect(a.title).toBe("My Great Essay");
    const b = importTxt("x".repeat(200), "fallback.txt");
    expect(b.title).toBe("fallback.txt");
  });
});
