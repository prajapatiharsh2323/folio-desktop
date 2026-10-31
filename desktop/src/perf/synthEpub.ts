// Deterministic synthetic EPUB fixture for the perf harness (FT-005).
// Builds a real, parseable EPUB whose *compressed* size is ≈ `targetBytes`
// (the "3 MB EPUB" in 04 §12 refers to the file as stored/shipped), with
// pseudo-random incompressible text so deflate cannot shrink it the way it
// would shrink a repetitive synthetic book.
import { zipSync, strToU8 } from "fflate";

// LCG for reproducible pseudo-random content (no Math.random — byte-identical
// runs stay comparable across hosts/days).
const SEED = 0x2f1719b7;
let rngState = SEED;
function rand(n: number): number {
  // xorshift-ish LCG; (2^31-1)-modulus keeps it deterministic.
  rngState = (Math.imul(rngState, 48271) >>> 0) % 2147483647;
  if (rngState === 0) rngState = 42;
  return rngState % n;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
function word(maxLen: number): string {
  const len = 3 + rand(maxLen - 2);
  let out = "";
  for (let i = 0; i < len; i++) out += LETTERS[rand(LETTERS.length)];
  return out;
}

function paragraph(index: number, n: number, words: number): string {
  const parts: string[] = [`${index}–${n} The`];
  for (let i = 0; i < words; i++) parts.push(word(9));
  return `<p>${parts.join(" ")}. </p>`;
}

function chapterXhtml(index: number, paragraphCount: number): string {
  const body: string[] = [];
  for (let n = 0; n < paragraphCount; n++) {
    body.push(paragraph(index, n, 18));
  }
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch ${index}</title></head>` +
    `<body><h1>Chapter ${index}</h1>${body.join("")}</body></html>`
  );
}

function zipLength(chapterTexts: string[], includeCover: boolean): number {
  const files: Record<string, Uint8Array> = {};
  chapterTexts.forEach((text, i) => {
    files[`OEBPS/Text/ch${i + 1}.xhtml`] = strToU8(text);
  });
  return zipSync(files).length + (includeCover ? 48 * 1024 : 0);
}

/**
 * A real EPUB whose compressed size is ≈ `targetBytes` (±20%) with `chapters`
 * even spine items. Deterministic for a given (targetBytes, chapters) — the
 * one-pass size estimate keeps generation cheap (no repeated compression of
 * the full text).
 */
export function buildSyntheticEpub(targetBytes: number, chapters = 24): Uint8Array {
  // Per-chapter storage overhead ≈ small; calibrate on one sample chapter.
  rngState = SEED;
  const sample = zipLength([chapterXhtml(1, 50)], false);
  const perParagraph = sample / 50;
  const budgetPerChapter = (targetBytes - chapters * 500) / chapters;
  const paragraphCount = Math.max(10, Math.round(budgetPerChapter / perParagraph));

  rngState = SEED;
  const chapterTexts: string[] = [];
  for (let i = 1; i <= chapters; i++) {
    // Distinct PRNG stream per chapter — identical chapter text would defeat
    // both the realism and the incompressibility.
    rngState = SEED ^ i;
    chapterTexts.push(chapterXhtml(i, paragraphCount));
  }

  const manifest = chapterTexts
    .map(
      (_, i) =>
        `<item id="c${i + 1}" href="Text/ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`
    )
    .join("");
  const spine = chapterTexts.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("");
  const opf =
    `<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">` +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Perf Fixture</dc:title>` +
    `<dc:creator>Harness</dc:creator><dc:language>en</dc:language>` +
    `<meta name="cover" content="cover-img"/></metadata>` +
    `<manifest>` +
    manifest +
    `<item id="cover-img" href="Images/cover.jpg" media-type="image/jpeg" properties=""/>` +
    `</manifest><spine>${spine}</spine></package>`;

  const container =
    `<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
    `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

  // Cover: real JPEG header plus opaque filler (not decoded during parse;
  // only the bytes are copied).
  const cover = new Uint8Array(48 * 1024);
  cover.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46], 0);
  cover.fill(0x5a, 16);

  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/Images/cover.jpg": cover,
  };
  chapterTexts.forEach((text, i) => {
    files[`OEBPS/Text/ch${i + 1}.xhtml`] = strToU8(text);
  });

  return zipSync(files);
}
