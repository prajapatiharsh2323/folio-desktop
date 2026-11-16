// Page text extraction + normalisation for PDFs (PDF plan §3). Pure logic on
// top of pdf.js text content; no DOM, unit-testable. The pdf.js types are
// structural so tests can feed plain fixtures without the library.
import type { PDFPageProxy } from "./pdfjsAdapter";

/** One text item as pdf.js reports it (TextItem | TextMarkedContent). */
export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

/** Join a page's text items into raw page text (plan §6.4): items joined with
 *  spaces, end-of-line markers become spaces, and a line break mid-word is
 *  re-joined when the next line starts in lower case (soft hyphenation). */
export function joinTextItems(items: PdfTextItem[]): string {
  let out = "";
  for (const item of items) {
    const str = item.str ?? "";
    if (str.length > 0) {
      if (out.length > 0) {
        const last = out[out.length - 1];
        // Hyphenated line break: "exam-\nple" → "example".
        if (last === "-" && /[a-z]/.test(str[0] ?? "")) {
          out = out.slice(0, -1);
        } else if (last !== " " && str !== " ") {
          out += " ";
        }
      }
      out += str;
    }
    if (item.hasEOL) out += " ";
  }
  return out;
}

/** Extract the raw text of one page (normalisation happens at search time). */
export async function extractPageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  return joinTextItems(content.items as PdfTextItem[]);
}

/** Count words the way the EPUB importer's wordCount does (whitespace runs). */
export function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}
