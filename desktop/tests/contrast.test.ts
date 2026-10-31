// Contrast audit over the checked-in token fixtures (03 §7, FT-006).
//
// Encodes the approved text/background pairs used in the shipped CSS and
// asserts they meet AA (4.5:1) on both themes. The muted-text failures are
// intentional negative cases: they document finding A-UI-20261031-03
// ("muted must not be used for functional labels") so regressions in either
// direction surface.
import { describe, expect, it } from "vitest";
import { AA_NORMAL, contrastRatio } from "../src/lib/contrast";
import tokens from "./fixtures/tokens.json";

const light = tokens.light as Record<string, string>;
const dark = tokens.dark as Record<string, string>;

describe("contrast audit (fixtures/tokens.json)", () => {
  it("approved text pairs meet AA on both themes", () => {
    for (const [tok, theme] of [
      [light, "light"],
      [dark, "dark"],
    ] as const) {
      const cases: Array<[string, string]> = [
        ["--folio-text-primary", "--folio-canvas"],
        ["--folio-text-primary", "--folio-surface"],
        ["--folio-text-primary", "--folio-surface-subtle"],
        ["--folio-text-primary", "--folio-surface-raised"],
        ["--folio-text-secondary", "--folio-canvas"],
        ["--folio-text-secondary", "--folio-surface"],
        ["--folio-text-secondary", "--folio-surface-subtle"],
        ["--folio-text-secondary", "--folio-surface-raised"],
        ["--folio-on-accent", "--folio-accent"],
        ["--folio-accent", "--folio-canvas"],
        ["--folio-accent", "--folio-surface"],
        ["--folio-accent", "--folio-accent-container"],
        ["--folio-danger", "--folio-canvas"],
        ["--folio-success", "--folio-canvas"],
        ["--folio-warning", "--folio-surface"],
      ];
      if (tok["--folio-on-danger-container"]) {
        cases.push(["--folio-on-danger-container", "--folio-danger-container"]);
      }
      for (const [fg, bg] of cases) {
        // The dark fixture defines only its subset of tokens; skip pairs the
        // theme does not carry.
        if (!tok[fg] || !tok[bg]) continue;
        const ratio = contrastRatio(tok[fg], tok[bg]);
        expect(ratio, `${fg} on ${bg} (${theme}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
          AA_NORMAL
        );
      }
    }
  });

  it("light muted text fails AA on light surfaces (A-UI-20261031-03 rationale)", () => {
    // #87897F can stay for decorative helper copy only. Functional labels must
    // use --folio-text-secondary (below) instead.
    for (const bg of ["--folio-canvas", "--folio-surface", "--folio-surface-subtle"]) {
      expect(contrastRatio(light["--folio-text-muted"], light[bg])).toBeLessThan(AA_NORMAL);
    }
    // And secondary is the substitute that passes.
    for (const bg of ["--folio-canvas", "--folio-surface", "--folio-surface-subtle"]) {
      expect(
        contrastRatio(light["--folio-text-secondary"], light[bg])
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it("dark muted sits just under AA on raised surfaces (documented)", () => {
    // Dark muted otherwise passes; this marginal case is recorded in the
    // audit report and does not gate the fix for the light-theme labels.
    expect(
      contrastRatio(dark["--folio-text-muted"], dark["--folio-surface-raised"])
    ).toBeLessThan(AA_NORMAL);
  });
});
