import type { ReadingTheme } from "../model/types";
import type { ThemeSetting } from "../theme/theme";

/**
 * The app appearance implied by a reading theme (O6). Setup offers both, and a
 * light reading page inside a dark app (or the reverse) is a surprise on first
 * launch, so choosing a reading theme updates the app preview until the user
 * picks an app appearance of their own.
 */
export function appThemeForReadingTheme(theme: ReadingTheme): ThemeSetting {
  switch (theme) {
    case "dark":
    case "true-black":
      return "dark";
    case "system":
      return "system";
    case "light":
    case "warm":
    default:
      return "light";
  }
}
