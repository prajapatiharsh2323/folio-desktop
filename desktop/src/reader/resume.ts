// Resume cascade (04 §8), as a pure decision so it's unit-testable:
//   1. locatorOverride (search hit / annotation tap): href + optional text
//      anchor, applied as a single anchored go()
//   2. saved progress.location:
//      a. `epubcfi(...)` → this build has no CFI API, so recompute from the
//         saved percent;
//      b. otherwise → use the stored href + progression + text anchor. This is
//         the desktop format (see locatorCodec) and also the plain `href`
//         fallback mobile writes, so it is preferred over the coarse percent;
//   3. plain percent when there is no usable location
//   4. else first spine item

import { decodeLocation } from "./locatorCodec";
import { withAnchor, type LocatorAnchor } from "./locatorCodec";

export interface ResumeOverride {
  /** annotation location hint: href + progression + anchor (see locatorCodec) */
  location?: string | null;
  percent?: number | null;
  /** text-quote jump when the stored location has no anchor of its own */
  anchor?: { quote: string; prefix: string; suffix: string } | null;
}

export interface SavedProgress {
  location: string;
  percent: number;
}

export type ResumePlan =
  | { kind: "override-locator"; locator: string; anchored: ResumeOverride["anchor"] }
  | { kind: "override-percent"; percent: number }
  | { kind: "saved-locator"; locator: string; percent: number }
  | { kind: "cfi"; cfi: string; fallbackPercent: number }
  | { kind: "percent"; percent: number }
  | { kind: "first" };

export function isCfi(location: string | null | undefined): boolean {
  return typeof location === "string" && /epubcfi\(/i.test(location);
}

/** Merge an override anchor into its locator so one navigation carries both. */
export function anchoredLocator(
  location: string,
  anchor: ResumeOverride["anchor"]
): string {
  return anchor?.quote ? withAnchor(location, anchor as LocatorAnchor) : location;
}

export function resumePlan(
  saved: SavedProgress | null,
  override?: ResumeOverride | null
): ResumePlan {
  // 1 — explicit override (04 §8 step 1)
  if (
    override &&
    (override.location || (override.percent !== undefined && override.percent !== null))
  ) {
    if (override.location) {
      return {
        kind: "override-locator",
        locator: anchoredLocator(override.location, override.anchor ?? null),
        anchored: override.anchor ?? null,
      };
    }
    return { kind: "override-percent", percent: override.percent as number };
  }

  // 2 — saved progress
  if (saved) {
    if (isCfi(saved.location)) {
      return { kind: "cfi", cfi: saved.location, fallbackPercent: saved.percent };
    }
    if (decodeLocation(saved.location)) {
      return {
        kind: "saved-locator",
        locator: saved.location,
        percent: saved.percent,
      };
    }
    return { kind: "percent", percent: saved.percent };
  }

  // 3/4 — first spine item
  return { kind: "first" };
}
