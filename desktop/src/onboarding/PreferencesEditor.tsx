import { useMemo } from "react";
import { FolioRadioGroup } from "../components/FolioRadioGroup";
import { FolioSectionHeader } from "../components/FolioSectionHeader";
import {
  clampFontSize,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  READER_THEME_COLORS,
} from "../model/defaults";
import type { ReadingPrefs, ReadingTheme } from "../model/types";
import { READING_THEME_OPTIONS, TYPEFACE_OPTIONS } from "../components/readingPrefsOptions";
import type { ThemeSetting } from "../theme/theme";

const APP_THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const SERIF_CSS = '"Iowan Old Style", Georgia, serif';

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

  // "Publisher" means the book supplies its own face; the picker and preview
  // must not pretend that is the app display font.
  const previewFont = prefs.fontFamily === "publisher" ? SERIF_CSS : undefined;
  const activeFont = useMemo(() => {
    const option =
      TYPEFACE_OPTIONS.find((font) => font.value === prefs.fontFamily) ?? TYPEFACE_OPTIONS[0];
    return prefs.fontFamily === "publisher" ? { ...option, css: SERIF_CSS } : option;
  }, [prefs.fontFamily]);

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
          <FolioRadioGroup
            label="App appearance"
            className="folio-wrap-row"
            value={appTheme}
            options={APP_THEME_OPTIONS}
            onChange={onAppThemeChange}
          />
          <p className="folio-helper">Light, dark, or follow your system setting.</p>
        </section>
      )}

      <section className="folio-preferences__group">
        <FolioSectionHeader>Reading theme</FolioSectionHeader>
        <FolioRadioGroup<ReadingTheme>
          label="Reading theme"
          className="folio-theme-grid"
          value={prefs.theme}
          options={READING_THEME_OPTIONS}
          onChange={(theme) => patch({ theme })}
          renderOption={({ option, selected, tabIndex, select, setButton }) => {
            const colors = READER_THEME_COLORS[option.value];
            const system = option.value === "system";
            return (
              <button
                ref={setButton}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={tabIndex}
                className={`folio-theme-swatch${selected ? " is-selected" : ""}`}
                onClick={select}
              >
                <span
                  className={`folio-theme-swatch__page${
                    system ? " folio-theme-swatch__page--split" : ""
                  }`}
                  style={system ? undefined : { background: colors.bg, color: colors.text }}
                  aria-hidden="true"
                >
                  Aa
                </span>
                <span className="folio-theme-swatch__label">{option.label}</span>
              </button>
            );
          }}
        />
      </section>

      <section className="folio-preferences__group">
        <FolioSectionHeader>Typeface</FolioSectionHeader>
        <FolioRadioGroup
          label="Typeface"
          className="folio-wrap-row"
          value={prefs.fontFamily}
          options={TYPEFACE_OPTIONS.map((font) => ({
            value: font.value,
            label: font.label,
            style: {
              fontFamily: font.value === "publisher" ? SERIF_CSS : font.css,
            },
          }))}
          onChange={(fontFamily) => patch({ fontFamily })}
        />
        {prefs.fontFamily === "publisher" && (
          <p className="folio-helper">Uses the book's own font — shown here in Serif.</p>
        )}
      </section>

      <section className="folio-preferences__group">
        <FolioSectionHeader>Text size</FolioSectionHeader>
        <div className="folio-stepper">
          <button
            type="button"
            className="folio-stepper__btn"
            aria-label="Smaller text"
            disabled={prefs.fontSize <= FONT_SIZE_MIN}
            onClick={() => patch({ fontSize: clampFontSize(prefs.fontSize - 1) })}
          >
            −
          </button>
          <input
            type="range"
            className="folio-slider"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
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
            disabled={prefs.fontSize >= FONT_SIZE_MAX}
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
          fontFamily: previewFont ?? activeFont.css,
          fontSize: `${prefs.fontSize}px`,
        }}
        aria-hidden="true"
      >
        The quick brown fox jumps over the lazy dog. Comfortable typography and clean margins make
        long reading sessions feel effortless.
      </div>
    </div>
  );
}
