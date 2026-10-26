// Positions list generation (04 §8): @readium/navigator expects a positions list
// to exist before it can paginate/jump by progression. Our EPUBs are opened from
// bytes without a served position-list manifest, so we synthesize the same kind of
// list the toolkit would get from a Readium positions service: one locator per
// ~1024 characters of a spine resource.
import { Locator, LocatorLocations, type Link, type Publication } from "@readium/shared";
import { strFromU8 } from "fflate";

/** Readium's default position length (characters) for reflowable EPUBs. */
export const POSITION_LENGTH = 1024;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    const named = HTML_ENTITIES[entity];
    if (named !== undefined) return named;
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

/** Extract human-readable text from an HTML/XHTML resource without a DOM.
 *  A DOM parse would be more faithful but also far more expensive for a 3 MB
 *  book; positions only need a stable character count. */
export function textLengthOfHtml(bytes: Uint8Array): number {
  let html = "";
  try {
    html = strFromU8(bytes);
  } catch {
    return 0;
  }
  const text = decodeEntities(
    html
      .replace(/<\?[\s\S]*?\?>/g, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
  return text.replace(/\s+/g, " ").trim().length;
}

export interface PositionedLink {
  link: Link;
  /** character length of the resource's text */
  length: number;
  /** number of positions assigned to this resource (>= 1) */
  count: number;
}

/**
 * Build a positions list from the publication reading order and a zip map.
 * Locators carry `position` (1-based, publication-wide), in-resource
 * `progression` and publication-wide `totalProgression` — enough for the
 * navigator's `go()`, percent jumps, and the progress pillar.
 */
export function generatePositions(
  publication: Publication,
  zip: Record<string, Uint8Array>
): Locator[] {
  const resources: PositionedLink[] = publication.readingOrder.items.map((link) => {
    const bytes = zip[link.href] ?? zip[decodeHref(link.href)];
    const length = bytes ? textLengthOfHtml(bytes) : 0;
    return { link, length, count: Math.max(1, Math.ceil(length / POSITION_LENGTH)) };
  });

  const total = resources.reduce((sum, r) => sum + r.count, 0);
  const positions: Locator[] = [];
  let index = 0;
  for (const resource of resources) {
    for (let i = 0; i < resource.count; i++) {
      const progression = resource.count <= 1 ? 0 : i / resource.count;
      positions.push(
        new Locator({
          href: resource.link.href,
          type: resource.link.type ?? "application/xhtml+xml",
          title: resource.link.title,
          locations: new LocatorLocations({
            position: index + 1,
            progression,
            totalProgression: total > 0 ? index / total : 0,
          }),
        })
      );
      index += 1;
    }
  }
  return positions;
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href.split("#")[0]);
  } catch {
    return href.split("#")[0];
  }
}

/**
 * Publication-wide progression (0..1) for a locator, using the position list
 * instead of the quantized `totalProgression` stamped on each position.
 */
export function progressionForLocator(
  locator: Locator,
  positions: Locator[]
): number | null {
  if (positions.length === 0) {
    return locator.locations.totalProgression ?? locator.locations.progression ?? null;
  }
  const href = locator.href.split("#")[0];
  const inResource = locator.locations.progression ?? 0;
  let firstForHref = -1;
  let countForHref = 0;
  for (let i = 0; i < positions.length; i++) {
    if (positions[i].href !== href) continue;
    if (firstForHref === -1) firstForHref = i;
    countForHref += 1;
  }
  if (firstForHref === -1) {
    return locator.locations.totalProgression ?? null;
  }
  return Math.min(1, (firstForHref + inResource * countForHref) / positions.length);
}

/** Locator for a 0..1 publication progression (scrubber / resume fallback). */
export function locatorForProgression(
  percent: number,
  positions: Locator[]
): Locator | null {
  if (positions.length === 0) return null;
  const p = Math.min(1, Math.max(0, percent));
  const idx = Math.min(positions.length - 1, Math.round(p * (positions.length - 1)));
  return positions[idx];
}
