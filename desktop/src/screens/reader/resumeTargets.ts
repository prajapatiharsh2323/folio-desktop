// Resume plan → engine open target (04 §8 step 2b): the toolkit's `go()`
// accepts CFIs only through a parsed locator; our byte-backed publication
// keeps the percent fallback.
import type { ReaderOpenTarget } from "../../reader/ReaderEngine";
import type { ResumePlan } from "../../reader/resume";

export function planTarget(plan: ResumePlan): ReaderOpenTarget | null {
  switch (plan.kind) {
    case "override-locator":
      return { location: plan.locator };
    case "override-percent":
      return { percent: plan.percent };
    case "cfi":
      return { percent: plan.fallbackPercent };
    case "saved-locator":
      return { location: plan.locator };
    case "percent":
      return { percent: plan.percent };
    case "first":
      return null;
  }
}
