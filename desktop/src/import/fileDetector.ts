// Format detection + refusals (02 §6; ImportDispatch.kt parity).
//   EPUB : zip with META-INF/container.xml
//   PDF  : %PDF magic → REFUSED "PDF is not supported"
//   HTML : extension or sniff
//   TXT  : extension or sniff
// DRM check for EPUB: META-INF/encryption.xml (except font-obfuscation algos)
// or META-INF/rights.xml → refuse.

import { unzipSync } from "fflate";

export type SourceFormatDetect = "epub" | "html" | "txt";

export class ImportError extends Error {
  constructor(
    public code: "too-large" | "pdf" | "drm" | "not-epub" | "unreadable" | "unknown",
    message: string
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export const COPY = {
  tooLarge: "This file is too large",
  pdf: "PDF is not supported",
  drm: "This book is protected and can't be imported",
} as const;

const FONT_OBFUSCATION_ALGOS = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://www.idpf.org/2010/embedding",
]);

function startsWithEpubZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7);
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 512).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html") || head.includes("<body");
}

/** Sniff the source format from a filename hint + bytes. */
export function detectFormat(fileName: string, bytes: Uint8Array): SourceFormatDetect {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".epub") || startsWithEpubZip(bytes)) return "epub";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "txt";
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 1024));
  if (looksLikeHtml(text)) return "html";
  return "txt";
}

/** Full gate: throws ImportError with user-facing copy on refusal. */
export function assertImportable(fileName: string, bytes: Uint8Array): SourceFormatDetect {
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError("too-large", COPY.tooLarge);

  // PDF refusal comes FIRST by magic (regardless of extension)
  if (bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    throw new ImportError("pdf", COPY.pdf);
  }

  const format = detectFormat(fileName, bytes);

  if (format === "epub") {
    if (!startsWithEpubZip(bytes)) throw new ImportError("unreadable", COPY.drm ? COPY.drm : "Unreadable file");
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
