// Format detection + refusals (02 §6; ImportDispatch.kt parity).
//   EPUB : zip with META-INF/container.xml
//   PDF  : %PDF magic — refused while FEATURES.pdf is off ("PDF is not
//          supported", mobile parity copy); imported behind the flag
//   HTML : extension or sniff
//   TXT  : extension or sniff
// DRM check for EPUB: META-INF/encryption.xml (except font-obfuscation algos)
// or META-INF/rights.xml → refuse.

import { unzipSync } from "fflate";
import { FEATURES } from "../lib/features";

export type SourceFormatDetect = "epub" | "html" | "txt" | "pdf";

export class ImportError extends Error {
  constructor(
    public code:
      | "too-large"
      | "pdf"
      | "drm"
      | "not-epub"
      | "unreadable"
      | "unknown"
      // additive (PDF plan §6.1); never raised while the flag is off
      | "encrypted",
    message: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** Target PDF cap (D5: 300 MB). Enabling it is gated on the raw-bytes IPC
 *  change (production-readiness report item E1): until bytes cross IPC
 *  without a JSON-number-array round trip, a large PDF would be unusable, so
 *  `pdfSizeCap()` still returns the 50 MB cap below. */
export const MAX_PDF_BYTES = 300 * 1024 * 1024;

/** The size cap actually enforced for PDFs today. Revisit once E1 lands. */
export function pdfSizeCap(): number {
  return MAX_IMPORT_BYTES;
}

export const COPY = {
  tooLarge: "This file is too large",
  pdf: "PDF is not supported",
  drm: "This book is protected and can't be imported",
  encrypted: "This PDF is password protected. Remove the password and import it again.",
  invalidPdf: "This file isn't a valid PDF",
  noPages: "This PDF has no pages",
} as const;

/** File name without its extension (basename, trimmed; "Untitled" fallback). */
export function stem(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  const i = base.lastIndexOf(".");
  return (i === -1 ? base : base.slice(0, i)).trim() || "Untitled";
}

/** Build the too-large copy with the actual sizes (plan §10). */
export function tooLargeMessage(bytesLength: number, cap: number): string {
  return `${COPY.tooLarge} (${Math.round(bytesLength / (1024 * 1024))} MB; limit is ${Math.round(cap / (1024 * 1024))} MB)`;
}

const FONT_OBFUSCATION_ALGOS = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://www.idpf.org/2010/embedding",
]);

function startsWithEpubZip(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7)
  );
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 512).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html") || head.includes("<body");
}

/** %PDF magic, tolerated anywhere in the first 1,024 bytes (pdf.js accepts a
 *  small header offset; plan §6.1). Only used when the flag is on. */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024);
  for (let i = 0; i + 4 <= limit; i++) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46
    ) {
      return true;
    }
  }
  return false;
}

/** Sniff the source format from a filename hint + bytes. */
export function detectFormat(fileName: string, bytes: Uint8Array): SourceFormatDetect {
  const lower = fileName.toLowerCase();
  if (FEATURES.pdf && (lower.endsWith(".pdf") || hasPdfMagic(bytes))) return "pdf";
  if (lower.endsWith(".epub") || startsWithEpubZip(bytes)) return "epub";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "txt";
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 1024));
  if (looksLikeHtml(text)) return "html";
  return "txt";
}

function startsWithPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

/** Full gate: throws ImportError with user-facing copy on refusal. */
export function assertImportable(fileName: string, bytes: Uint8Array): SourceFormatDetect {
  const isPdf = hasPdfMagic(bytes);

  if (!FEATURES.pdf) {
    // Legacy path, byte-for-byte today's order and copy: size cap first, then
    // the offset-0 PDF magic refusal (flag off ⇒ exactly the old behaviour).
    if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError("too-large", COPY.tooLarge);
    if (startsWithPdf(bytes)) throw new ImportError("pdf", COPY.pdf);
  } else if (isPdf) {
    // PDF branch: its own cap, applied before anything else about the file.
    const cap = pdfSizeCap();
    if (bytes.length > cap) throw new ImportError("too-large", tooLargeMessage(bytes.length, cap));
    return "pdf";
  } else if (bytes.length > MAX_IMPORT_BYTES) {
    throw new ImportError("too-large", tooLargeMessage(bytes.length, MAX_IMPORT_BYTES));
  }

  const format = detectFormat(fileName, bytes);

  if (format === "epub") {
    if (!startsWithEpubZip(bytes))
      throw new ImportError("unreadable", COPY.drm ? COPY.drm : "Unreadable file");
    let zip: Record<string, Uint8Array>;
    try {
      zip = unzipSync(bytes);
    } catch {
      throw new ImportError("unreadable", "This file can't be opened");
    }
    if (!zip["META-INF/container.xml"]) {
      throw new ImportError("not-epub", "This file can't be opened");
    }
    assertNoDrm(zip);
    return "epub";
  }
  return format;
}

/** encryption.xml scan: refuse unless every EncryptionMethod is font obfuscation. */
export function assertNoDrm(zip: Record<string, Uint8Array>): void {
  const enc = zip["META-INF/encryption.xml"];
  const decoder = new TextDecoder();
  if (enc) {
    const xml = decoder.decode(enc);
    const algos = [...xml.matchAll(/EncryptionMethod[^>]*\bAlgorithm="([^"]+)"/g)].map((m) => m[1]);
    if (algos.length === 0) throw new ImportError("drm", COPY.drm);
    for (const a of algos) {
      if (!FONT_OBFUSCATION_ALGOS.has(a)) throw new ImportError("drm", COPY.drm);
    }
  }
  if (zip["META-INF/rights.xml"]) throw new ImportError("drm", COPY.drm);
}

/** Devanagari letter ratio > 0.3 → 'hi' else 'en' (02 §6 TXT importer). */
export function detectLanguage(text: string): "en" | "hi" {
  const letters = text.match(/[\p{L}]/gu) ?? [];
  if (letters.length === 0) return "en";
  const deva = text.match(/[\u0900-\u097F]/gu) ?? [];
  return deva.length / letters.length > 0.3 ? "hi" : "en";
}
