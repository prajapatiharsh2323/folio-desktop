import { useMemo, type CSSProperties } from "react";
import { FolioChip } from "../components/FolioChip";
import { FolioSectionHeader } from "../components/FolioSectionHeader";
import {
  clampFontSize,
  READER_THEME_COLORS,
} from "../model/defaults";
import type { ReadingPrefs } from "../model/types";
import {
  READING_THEME_OPTIONS,
  TYPEFACE_OPTIONS,
} from "../components/readingPrefsOptions";
import type { ThemeSetting } from "../theme/theme";

const APP_THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export interface PreferencesEditorProps {
  prefs: ReadingPrefs;
  onChange: (next: ReadingPrefs) => void;
  /** Omit both app-theme props to hide app appearance (Settings owns it). */
  appTheme?: ThemeSetting;
  onAppThemeChange?: (setting: ThemeSetting) => void;
  showAppAppearance?: boolean;
}

/**
 * Shared preference form: app appearance (optional), reading theme, typeface,
 * and text size. Used by first-run setup and by Settings so the two cannot
 * drift apart.
 */
export function PreferencesEditor({
  prefs,
  onChange,
  appTheme,
  onAppThemeChange,
  showAppAppearance = false,
}: PreferencesEditorProps) {
  const patch = (part: Partial<ReadingPrefs>) => onChange({ ...prefs, ...part });
  const activeFont =
    TYPEFACE_OPTIONS.find((f) => f.value === prefs.fontFamily) ?? TYPEFACE_OPTIONS[0];

  const previewColors = useMemo(() => {
    if (prefs.theme === "system") {
      const isDark =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      return READER_THEME_COLORS[isDark ? "dark" : "light"];
    }
    return READER_THEME_COLORS[prefs.theme];
  }, [prefs.theme]);

  return (
    <div className="folio-preferences">
      {showAppAppearance && appTheme !== undefined && onAppThemeChange && (
        <section className="folio-preferences__group">
          <FolioSectionHeader>App appearance</FolioSectionHeader>
          <div className="folio-wrap-row" role="group" aria-label="App appearance">
            {APP_THEME_OPTIONS.map((option) => (
              <FolioChip
                key={option.value}
                selected={appTheme === option.value}
                onClick={() => onAppThemeChange(option.value)}
              >
                {option.label}
              </FolioChip>
            ))}
          </div>
          <p className="folio-helper">Light, dark, or follow your system setting.</p>
        </section>
      )}

      <section className="folio-preferences__group">
        <FolioSectionHeader>Reading theme</FolioSectionHeader>
        <div className="folio-theme-grid" role="radiogroup" aria-label="Reading theme">
          {READING_THEME_OPTIONS.map((theme) => {
            const colors = READER_THEME_COLORS[theme.value];
            const selected = prefs.theme === theme.value;
            return (
              <button
                key={theme.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`folio-theme-swatch${selected ? " is-selected" : ""}`}
                onClick={() => patch({ theme: theme.value })}
              >
                <span
                  className="folio-theme-swatch__page"
                  style={{ background: colors.bg, color: colors.text }}
                  aria-hidden="true"
                >
                  Aa
                </span>
                <span className="folio-theme-swatch__label">{theme.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="folio-preferences__group">
        <FolioSectionHeader>Typeface</FolioSectionHeader>
        <div className="folio-wrap-row" role="radiogroup" aria-label="Typeface">
          {TYPEFACE_OPTIONS.map((font) => (
            <FolioChip
              key={font.value}
              selected={prefs.fontFamily === font.value}
              asRadio
              style={{ fontFamily: font.css } as CSSProperties}
              onClick={() => patch({ fontFamily: font.value })}
            >
              {font.label}
            </FolioChip>
          ))}
        </div>
      </section>

      <section className="folio-preferences__group">
        <FolioSectionHeader>Text size</FolioSectionHeader>
        <div className="folio-stepper">
          <button
            type="button"
            className="folio-stepper__btn"
            aria-label="Smaller text"
            disabled={prefs.fontSize <= 14}
            onClick={() => patch({ fontSize: clampFontSize(prefs.fontSize - 1) })}
          >
            −
          </button>
          <input
            type="range"
            className="folio-slider"
            min={14}
            max={32}
            step={1}
            value={prefs.fontSize}
            aria-label="Text size"
            aria-valuetext={`${prefs.fontSize} pixels`}
            onChange={(e) => patch({ fontSize: clampFontSize(Number(e.currentTarget.value)) })}
          />
          <button
            type="button"
            className="folio-stepper__btn"
            aria-label="Larger text"
            disabled={prefs.fontSize >= 32}
            onClick={() => patch({ fontSize: clampFontSize(prefs.fontSize + 1) })}
          >
            +
          </button>
          <span className="folio-control-value">{prefs.fontSize}px</span>
        </div>
      </section>

      <div
        className="folio-typography-preview folio-preferences__preview"
        style={{
          backgroundColor: previewColors.bg,
          color: previewColors.text,
          fontFamily: activeFont.css,
          fontSize: `${Math.min(22, Math.max(14, prefs.fontSize))}px`,
        }}
        aria-hidden="true"
      >
        The quick brown fox jumps over the lazy dog. Comfortable typography and
        clean margins make long reading sessions feel effortless.
      </div>
    </div>
  );
}
