// Resume cascade (04 §8), as a pure decision so it's unit-testable:
//   1. locatorOverride (search hit / annotation tap): chapter href first; then,
//      if quote+prefix+suffix are available, a second anchored go()
//   2. saved progress.location:
//      a. contains a CFI → apply directly (web toolkit parses CFI);
//      b. otherwise / if CFI unsupported → recompute in-chapter fraction from
//         saved.percent via the navigator's positions list → percent
//   3. plain percent when location has no CFI
//   4. else first spine item

export interface ResumeOverride {
  /** annotation location hint (chapter href first) */
  location?: string | null;
  percent?: number | null;
  /** anchored text jump (second step) when available */
  anchor?: { quote: string; prefix: string; suffix: string } | null;
}

export interface SavedProgress {
  location: string;
  percent: number;
}

export type ResumePlan =
  | { kind: "override-locator"; locator: string; anchored: ResumeOverride["anchor"] }
  | { kind: "override-percent"; percent: number }
  | { kind: "cfi"; cfi: string; fallbackPercent: number }
  | { kind: "percent"; percent: number }
  | { kind: "first" };

export function isCfi(location: string | null | undefined): boolean {
  return typeof location === "string" && /epubcfi\(/i.test(location);
}

export function resumePlan(
  saved: SavedProgress | null,
  override?: ResumeOverride | null
): ResumePlan {
  // 1 — explicit override (04 §8 step 1)
  if (override && (override.location || override.percent !== undefined && override.percent !== null)) {
    if (override.location) {
      return {
        kind: "override-locator",
        locator: override.location,
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
    return { kind: "percent", percent: saved.percent };
  }

  // 3/4 — first spine item
  return { kind: "first" };
}
