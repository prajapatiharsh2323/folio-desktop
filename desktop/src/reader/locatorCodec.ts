// Persisted locator strings (schema-1 `Progress.location` / `Annotation.location`).
//
// Mobile writes `epubcfi(...)`, but the installed `@readium/navigator` and
// `@readium/shared` builds expose no CFI APIs — and a CFI is tied to one
// rendering of one EPUB. Desktop therefore persists a locator built from three
// things that survive repagination and re-import:
//
//   href        the spine resource (stable, part of the publication)
//   progression 0..1 position inside that resource
//   anchor      text quote + prefix/suffix, resolved through Readium's
//               TextQuoteAnchor (`rangeFromLocator`), which is also how
//               decorations find their range
//
// Serialized as a query suffix so the value stays a single string:
//
//   ch1.xhtml?p=0.4286&q=Call%20me&b=pre&a=post#note1
//
// Every part is optional and unknown query parameters are treated as part of
// the href, so `ch1.xhtml`, `ch1.xhtml#frag`, and `ch1.xhtml?v=2` all still
// decode. `epubcfi(...)` values are rejected by `decodeLocation` so callers can
// fall back to the saved percent.

export interface LocatorAnchor {
  quote: string;
  prefix?: string;
  suffix?: string;
}

export interface FolioLocation {
  href: string;
  /** element id inside the resource (no leading '#') */
  fragment?: string;
  /** 0..1 in-resource progression */
  progression?: number;
  anchor?: LocatorAnchor;
}

/** Quotes longer than this add no uniqueness but bloat progress.json. */
const MAX_ANCHOR_CHARS = 200;
const FOLIO_PARAMS = ["p", "q", "b", "a"] as const;
type FolioParam = (typeof FOLIO_PARAMS)[number];

function isFolioParam(key: string): key is FolioParam {
  return (FOLIO_PARAMS as readonly string[]).includes(key);
}

/** True for `epubcfi(...)`, the mobile-written format this build cannot resolve. */
export function isCfiLocation(value: unknown): boolean {
  return typeof value === "string" && /^\s*epubcfi\(/i.test(value);
}

function clampProgression(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(1, Math.max(0, value));
  // 0 means "start of the resource", which is what an absent value already says.
  if (clamped <= 0) return undefined;
  return Number(clamped.toFixed(6));
}

function clip(value: string | undefined): string {
  return (value ?? "").slice(0, MAX_ANCHOR_CHARS);
}

function cleanHref(href: string): string {
  return href.replace(/^\.\//, "").trim();
}

/** Serialize a locator. Returns "" when there is no usable href. */
export function encodeLocation(loc: FolioLocation): string {
  const href = cleanHref(loc.href ?? "");
  if (!href) return "";
  const fragment = (loc.fragment ?? "").replace(/^#/, "");

  const params = new URLSearchParams();
  const progression = clampProgression(loc.progression);
  if (progression !== undefined) params.set("p", String(progression));
  const quote = clip(loc.anchor?.quote);
  if (quote) {
    params.set("q", quote);
    const prefix = clip(loc.anchor?.prefix);
    const suffix = clip(loc.anchor?.suffix);
    if (prefix) params.set("b", prefix);
    if (suffix) params.set("a", suffix);
  }

  const query = params.toString();
  const base = query
    ? `${href}${href.includes("?") ? "&" : "?"}${query}`
    : href;
  return fragment ? `${base}#${fragment}` : base;
}

/** Parse a persisted locator. Returns null for empty/CFI/garbage values. */
export function decodeLocation(value: string | null | undefined): FolioLocation | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || isCfiLocation(raw)) return null;

  const hash = raw.lastIndexOf("#");
  const beforeHash = hash >= 0 ? raw.slice(0, hash) : raw;
  const fragment = hash >= 0 ? raw.slice(hash + 1) : "";

  const mark = beforeHash.indexOf("?");
  if (mark < 0) {
    const href = cleanHref(beforeHash);
    if (!href) return null;
    return { href, fragment: fragment || undefined };
  }

  const path = beforeHash.slice(0, mark);
  const params = new URLSearchParams(beforeHash.slice(mark + 1));
  const hasFolioParams = FOLIO_PARAMS.some((key) => params.has(key));
  if (!hasFolioParams) {
    // A query string that belongs to the href, not to us.
    const href = cleanHref(beforeHash);
    if (!href) return null;
    return { href, fragment: fragment || undefined };
  }

  const rest = new URLSearchParams();
  for (const [key, paramValue] of params) {
    if (!isFolioParam(key)) rest.append(key, paramValue);
  }
  const restQuery = rest.toString();
  const href = cleanHref(restQuery ? `${path}?${restQuery}` : path);
  if (!href) return null;

  const rawProgression = params.get("p");
  const progression =
    rawProgression === null ? undefined : clampProgression(Number(rawProgression));
  const quote = clip(params.get("q") ?? "");
  const anchor = quote
    ? {
        quote,
        prefix: params.get("b") ?? "",
        suffix: params.get("a") ?? "",
      }
    : undefined;

  return { href, fragment: fragment || undefined, progression, anchor };
}

/** The resource href of a stored locator; null when unusable. */
export function hrefOf(value: string | null | undefined): string | null {
  return decodeLocation(value)?.href ?? null;
}

/** The text anchor of a stored locator, if any. */
export function anchorOf(value: string | null | undefined): LocatorAnchor | null {
  return decodeLocation(value)?.anchor ?? null;
}

/** Tolerance for "same place in the book" — one ten-thousandth of a resource. */
const SAME_PROGRESSION_EPSILON = 0.0001;

/**
 * True when two stored locators point at the same place. Used to dedupe
 * bookmarks: the engine emits slightly different progressions for the same
 * page as the viewport settles, so string equality is too strict.
 */
export function sameLocation(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = decodeLocation(a);
  const right = decodeLocation(b);
  if (!left || !right) return false;
  if (left.href !== right.href) return false;
  if ((left.fragment ?? "") !== (right.fragment ?? "")) return false;
  return (
    Math.abs((left.progression ?? 0) - (right.progression ?? 0)) <=
    SAME_PROGRESSION_EPSILON
  );
}

/**
 * Attach (or clear) the text anchor on a stored locator, keeping its href,
 * fragment and progression. A null anchor leaves the value untouched.
 */
export function withAnchor(
  value: string,
  anchor: LocatorAnchor | null | undefined
): string {
  if (!anchor) return value;
  const base = decodeLocation(value);
  if (!base) return value;
  if (!anchor.quote) return encodeLocation({ ...base, anchor: undefined });
  return encodeLocation({
    ...base,
    anchor: {
      quote: anchor.quote,
      prefix: anchor.prefix ?? "",
      suffix: anchor.suffix ?? "",
    },
  });
}
