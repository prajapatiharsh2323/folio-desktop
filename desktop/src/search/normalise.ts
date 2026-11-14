// Search normalization — port of mobile core/search/SearchNormalise.kt.
//
// Order is load-bearing (06 §6): NFC → lowercase → strip ZWJ/ZWNJ →
// latin-only accent folding → (Devanagari combining marks preserved).
export function normalizeQuery(input: string): string {
  if (!input) return "";
  // 1. NFC
  let s = input.normalize("NFC");
  // 2. lowercase (locale-independent for determinism)
  s = s.toLowerCase();
  // 3. strip zero-width joiner / non-joiner
  s = s.replace(/[\u200C\u200D]/g, "");
  // 4. latin-only accent folding (preserve Devanagari combining marks)
  s = foldLatinAccents(s);
  // 5. collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

const LATIN_FOLD: Record<string, string> = {
  á: "a",
  à: "a",
  â: "a",
  ä: "a",
  ã: "a",
  å: "a",
  ā: "a",
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  ē: "e",
  ĕ: "e",
  í: "i",
  ì: "i",
  î: "i",
  ï: "i",
  ī: "i",
  ó: "o",
  ò: "o",
  ô: "o",
  ö: "o",
  õ: "o",
  ø: "o",
  ō: "o",
  ú: "u",
  ù: "u",
  û: "u",
  ü: "u",
  ū: "u",
  ý: "y",
  ÿ: "y",
  ñ: "n",
  ç: "c",
  ß: "ss",
  æ: "ae",
  œ: "oe",
};

function foldLatinAccents(s: string): string {
  let out = "";
  for (const ch of s) {
    out += LATIN_FOLD[ch] ?? ch;
  }
  return out;
}

export interface FoldedText {
  text: string;
  /** srcStart[i] = source string index (code units) of the char at output index i. */
  srcStart: number[];
  /** srcEnd[i] = source index just past the char at output index i. */
  srcEnd: number[];
}

/**
 * Lowercase + latin accent fold that keeps a per-character map back to the
 * source. Unlike normalizeQuery there is no NFC, no zero-width stripping and
 * no whitespace collapse, so the output stays aligned with the input and
 * occurrences found in the folded text can be sliced from the raw text.
 */
export function foldWithMap(input: string): FoldedText {
  let out = "";
  const srcStart: number[] = [];
  const srcEnd: number[] = [];
  let i = 0;
  while (i < input.length) {
    const code = input.codePointAt(i)!;
    const width = code > 0xffff ? 2 : 1;
    const ch = String.fromCodePoint(code);
    const lower = ch.toLowerCase();
    for (const lowCh of lower) {
      const folded = LATIN_FOLD[lowCh] ?? lowCh;
      out += folded;
      for (let k = 0; k < folded.length; k++) {
        srcStart.push(i);
        srcEnd.push(i + width);
      }
    }
    i += width;
  }
  return { text: out, srcStart, srcEnd };
}

export { normalizeQuery as normalize };
export default normalizeQuery;
