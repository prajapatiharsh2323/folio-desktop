// Headword normalization port of mobile core/dictionary/DictionaryNormalizer.kt.
export function normalizeHeadword(input: string): string {
  if (!input) return "";
  let s = input.normalize("NFC").trim().toLowerCase();
  // strip diacritics for latin headwords (keep devanagari)
  s = s.replace(/[\u0300-\u036f]/g, "");
  // collapse internal whitespace
  s = s.replace(/\s+/g, " ");
  return s;
}

export function normalizeLookupTerm(input: string): string {
  return normalizeHeadword(input).replace(/[^\w\s\u0900-\u097f]/g, "");
}
