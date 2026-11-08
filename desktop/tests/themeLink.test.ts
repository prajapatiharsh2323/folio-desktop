import { describe, expect, it } from "vitest";
import { appThemeForReadingTheme } from "../src/onboarding/themeLink";

describe("app theme linked to reading theme", () => {
  it("pairs light reading themes with the light app", () => {
    expect(appThemeForReadingTheme("light")).toBe("light");
    expect(appThemeForReadingTheme("warm")).toBe("light");
  });

  it("pairs dark reading themes with the dark app", () => {
    expect(appThemeForReadingTheme("dark")).toBe("dark");
    expect(appThemeForReadingTheme("true-black")).toBe("dark");
  });

  it("keeps system as system", () => {
    expect(appThemeForReadingTheme("system")).toBe("system");
  });
});
