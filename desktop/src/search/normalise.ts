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
  á: "a", à: "a", â: "a", ä: "a", ã: "a", å: "a", ā: "a",
  é: "e", è: "e", ê: "e", ë: "e", ē: "e", ĕ: "e",
  í: "i", ì: "i", î: "i", ï: "i", ī: "i",
  ó: "o", ò: "o", ô: "o", ö: "o", õ: "o", ø: "o", ō: "o",
  ú: "u", ù: "u", û: "u", ü: "u", ū: "u",
  ý: "y", ÿ: "y",
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

export { normalizeQuery as normalize };
export default normalizeQuery;
