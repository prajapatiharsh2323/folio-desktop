// Shared HTML→text extraction (R1): one implementation for the reader search
// corpus, the positions list, and the importers' chapter text.
//
// String-based on purpose: a DOM parse would be far more expensive for a 3 MB
// book, and every consumer either needs only a length, a tokenizable corpus,
// or an already-sanitized article body. Entity decoding matches what a
// browser's textContent would produce so text extracted here can also serve
// as a text-quote anchor (the navigator matches against frame textContent,
// with approximate fallback for whitespace deltas).

/** Named entities worth decoding for book text; numeric refs handled generically. */
const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  laquo: "\u00ab",
  raquo: "\u00bb",
  middot: "\u00b7",
  bull: "\u2022",
  dagger: "\u2020",
  Dagger: "\u2021",
  permil: "\u2030",
  prime: "\u2032",
  Prime: "\u2033",
  deg: "\u00b0",
  plusmn: "\u00b1",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  times: "\u00d7",
  divide: "\u00f7",
  eacute: "\u00e9",
  egrave: "\u00e8",
  agrave: "\u00e0",
  ccedil: "\u00e7",
  uuml: "\u00fc",
  ouml: "\u00f6",
  auml: "\u00e4",
  szlig: "\u00df",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, entity: string) => {
    const named = HTML_ENTITIES[entity];
    if (named !== undefined) return named;
    if (entity[0] === "#" && (entity[1] === "x" || entity[1] === "X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (entity[0] === "#") {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

/**
 * Extract human-readable text from an HTML/XHTML resource without a DOM.
 * Removes the XML prolog, comments, and script/style/head (with content);
 * every remaining tag becomes a separator so words never merge across
 * boundaries; entities are decoded; whitespace runs collapse to one space.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\?[\s\S]*?\?>/g, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(script|style|head)\b[^>]*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}
