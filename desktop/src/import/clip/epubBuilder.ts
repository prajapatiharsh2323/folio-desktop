// EPUB 3 builder for TXT/HTML imports (02 §6, EpubBuilder.kt behavior):
// mimetype first entry stored uncompressed, nav.xhtml chapter list (3–5
// chapters for articles), deterministic uuid from contentHash.
import { strToU8, zipSync } from "fflate";
import type { Chapter } from "../../model/types";

export interface BuilderChapter {
  title: string;
  /** sanitized XHTML body innerHTML (already Folio allow-list clean) */
  html: string;
}

export interface BuildEpubResult {
  bytes: Uint8Array;
  chapters: Chapter[];
}

export function uuidFromContentHash(contentHash: string): string {
  const h = contentHash.padEnd(32, "0").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chapterXhtml(title: string, html: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${esc(title)}</title></head>
<body><section>${html}</section></body>
</html>`;
}

function navXhtml(chapters: Chapter[], bookTitle: string): string {
  const lis = chapters
    .map((c) => `<li><a href="${esc(c.href)}">${esc(c.title)}</a></li>`)
    .join("\n      ");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${esc(bookTitle)}</title></head>
<body><nav epub:type="toc" id="toc"><h1>${esc(bookTitle)}</h1>
<ol>
      ${lis}
</ol></nav></body>
</html>`;
}

function contentOpf(opts: {
  uuid: string;
  title: string;
  author?: string | null;
  language: string;
  chapterCount: number;
  images: string[];
}): string {
  const modified = new Date(0).toISOString().replace(/\.\d{3}Z$/, "Z");
  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    ...Array.from({ length: opts.chapterCount }, (_, i) => {
      const props = i === 0 && opts.images.length === 0 ? "" : "";
      void props;
      return `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`;
    }),
    ...opts.images.map((img, i) => {
      const mt = img.endsWith(".png") ? "image/png" : img.endsWith(".gif") ? "image/gif" : img.endsWith(".svg") ? "image/svg+xml" : "image/jpeg";
      return `<item id="img${i + 1}" href="images/${img}" media-type="${mt}"/>`;
    }),
  ].join("\n    ");
  const spineItems = Array.from({ length: opts.chapterCount }, (_, i) => `<itemref idref="ch${i + 1}"/>`).join("\n    ");
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${opts.uuid}</dc:identifier>
    <dc:title>${esc(opts.title)}</dc:title>
    ${opts.author ? `<dc:creator>${esc(opts.author)}</dc:creator>` : ""}
    <dc:language>${esc(opts.language)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;
}

const FIXED_MTIME = Date.UTC(2000, 0, 1); // deterministic + within zip DOS range (1980–2099)

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

/** Build the EPUB 3 reading edition. Deterministic bytes for identical input. */
export async function buildEpub(input: {
  title: string;
  author?: string | null;
  language: string;
  contentHash: string;
  chapters: BuilderChapter[];
  /** image file names already placed under OEBPS/images/ */
  images?: string[];
}): Promise<BuildEpubResult> {
  const uuid = uuidFromContentHash(input.contentHash);
  const chapters: Chapter[] = input.chapters.map((c, i) => ({
    id: `ch${i + 1}`,
    title: c.title || `Chapter ${i + 1}`,
    order: i,
    href: `OEBPS/ch${i + 1}.xhtml`,
  }));

  const files: Record<string, [Uint8Array, Record<string, unknown>]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0, mtime: FIXED_MTIME }],
    "META-INF/container.xml": [strToU8(CONTAINER_XML), { level: 6, mtime: FIXED_MTIME }],
    "OEBPS/content.opf": [
      strToU8(
        contentOpf({
          uuid,
          title: input.title,
          author: input.author,
          language: input.language,
          chapterCount: chapters.length,
          images: input.images ?? [],
        })
      ),
      { level: 6, mtime: FIXED_MTIME },
    ],
    "OEBPS/nav.xhtml": [strToU8(navXhtml(chapters, input.title)), { level: 6, mtime: FIXED_MTIME }],
  };
  chapters.forEach((c, i) => {
    files[`OEBPS/ch${i + 1}.xhtml`] = [
      strToU8(chapterXhtml(c.title, input.chapters[i].html)),
      { level: 6, mtime: FIXED_MTIME },
    ];
  });

  const bytes = zipSync(files as never);
  return { bytes, chapters };
}
