import { useMemo, type CSSProperties } from "react";
import { FolioButton } from "./FolioButton";
import { FolioChip } from "./FolioChip";
import { FolioPanel } from "./FolioPanel";
import { FolioRadioGroup } from "./FolioRadioGroup";
import { FolioSectionHeader } from "./FolioSectionHeader";
import {
  clampBrightness,
  clampFontSize,
  clampLetterSpacing,
  clampLineHeight,
  clampMargin,
  clampMaxWidth,
  clampParagraphSpacing,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  READER_THEME_COLORS,
} from "../model/defaults";
import type { ReadingPrefs } from "../model/types";
import { READING_THEME_OPTIONS, TYPEFACE_OPTIONS } from "./readingPrefsOptions";

const SERIF_CSS = '"Iowan Old Style", Georgia, serif';
const ALIGNMENT_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "justify", label: "Justify" },
] as const;
const FLOW_OPTIONS = [
  { value: "paginated", label: "Paginated" },
  { value: "scrolled", label: "Scrolled" },
] as const;

const WIDTH_PRESETS: { label: string; value: number }[] = [
  { label: "Compact", value: 640 },
  { label: "Standard", value: 880 },
  { label: "Wide", value: 1120 },
  { label: "Full width", value: 0 },
];

interface AppearancePanelProps {
  open: boolean;
  prefs: ReadingPrefs;
  onClose: () => void;
  onChange: (next: ReadingPrefs) => void;
  /** removes this book's override, restoring the global defaults (04 §3) */
  onReset: () => void;
}

/**
 * Appearance panel (04 §3): per-book ReadingPrefs, right-anchored.
 * Provides quick appearance controls (font size steppers, theme swatches,
 * width presets), live typography preview, and fine-grained advanced controls.
 */
export function AppearancePanel({ open, prefs, onClose, onChange, onReset }: AppearancePanelProps) {
  const patch = (part: Partial<ReadingPrefs>) => onChange({ ...prefs, ...part });

  const activeFont =
    prefs.fontFamily === "publisher"
      ? { ...TYPEFACE_OPTIONS[0], css: SERIF_CSS }
      : (TYPEFACE_OPTIONS.find((f) => f.value === prefs.fontFamily) ?? TYPEFACE_OPTIONS[0]);
  const previewColors = useMemo(() => {
    if (prefs.theme === "system") {
      const isDark =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      return READER_THEME_COLORS[isDark ? "dark" : "light"];
    }
    return READER_THEME_COLORS[prefs.theme];
  }, [prefs.theme]);

  // Presets are approximate: a width set with the slider still shows the
  // nearest preset as active so the quick row never looks unselected.
  const widthPreset =
    prefs.maxWidth === 0
      ? "0"
      : (WIDTH_PRESETS.find(
          (p) => p.value > 0 && Math.abs(prefs.maxWidth - p.value) <= 40,
        )?.value.toString() ?? "");

  return (
    <FolioPanel open={open} onClose={onClose} title="Appearance" width={400}>
      <div className="folio-appearance">
        {/* Quick Appearance Area */}
        <div className="folio-appearance__quick-card">
          <div className="folio-appearance__quick-title">Quick Adjustments</div>

          <div className="folio-appearance__quick-row">
            <div
              className="folio-appearance__quick-stepper"
              role="group"
              aria-label="Quick font size"
            >
              <button
                type="button"
                className="folio-appearance__quick-btn"
                aria-label="Decrease text size"
                disabled={prefs.fontSize <= FONT_SIZE_MIN}
                onClick={() => patch({ fontSize: clampFontSize(prefs.fontSize - 1) })}
              >
                A−
              </button>
              <span className="folio-appearance__quick-size" aria-live="polite">
                {prefs.fontSize}px
              </span>
              <button
                type="button"
                className="folio-appearance__quick-btn"
                aria-label="Increase text size"
                disabled={prefs.fontSize >= FONT_SIZE_MAX}
                onClick={() => patch({ fontSize: clampFontSize(prefs.fontSize + 1) })}
              >
                A+
              </button>
            </div>

            <FolioRadioGroup
              label="Reading column width presets"
              className="folio-appearance__quick-presets"
              value={widthPreset}
              options={WIDTH_PRESETS.map((p) => ({
                value: String(p.value),
                label: p.label,
              }))}
              onChange={(key) => patch({ maxWidth: Number(key) })}
              renderOption={({ option, selected, tabIndex, select, setButton }) => (
                <button
                  ref={setButton}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={tabIndex}
                  className={`folio-appearance__preset-chip${selected ? " is-active" : ""}`}
                  onClick={select}
                >
                  {option.label}
                </button>
              )}
            />
          </div>

          <div className="folio-appearance__quick-row" style={{ marginTop: 4 }}>
            <FolioRadioGroup
              label="Text alignment"
              className="folio-appearance__quick-presets"
              value={prefs.justify ? "justify" : "left"}
              options={[...ALIGNMENT_OPTIONS]}
              onChange={(value) => patch({ justify: value === "justify" })}
              renderOption={({ option, selected, tabIndex, select, setButton }) => (
                <button
                  ref={setButton}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={tabIndex}
                  className={`folio-appearance__toggle-chip${selected ? " is-active" : ""}`}
                  onClick={select}
                >
                  {option.label}
                </button>
              )}
            />

            <button
              type="button"
              role="switch"
              aria-checked={prefs.hyphenate}
              className={`folio-appearance__toggle-chip${prefs.hyphenate ? " is-active" : ""}`}
              onClick={() => patch({ hyphenate: !prefs.hyphenate })}
              aria-label="Toggle hyphenation"
            >
              Hyphenate: {prefs.hyphenate ? "On" : "Off"}
            </button>
          </div>
        </div>

        {/* Typography Live Preview */}
        <section className="folio-appearance__preview-section">
          <FolioSectionHeader>Typography Preview</FolioSectionHeader>
          <div
            className="folio-typography-preview"
            style={{
              backgroundColor: previewColors.bg,
              color: previewColors.text,
              fontFamily: activeFont.css,
              fontSize: `${Math.min(22, Math.max(14, prefs.fontSize))}px`,
              lineHeight: prefs.lineHeight,
              letterSpacing: `${prefs.letterSpacing}em`,
              textAlign: prefs.justify ? "justify" : "left",
              hyphens: prefs.hyphenate ? "auto" : "none",
            }}
            aria-hidden="true"
          >
            The quick brown fox jumps over the lazy dog. Comfortable typography and clean margins
            deliver an immersive, distraction-free reading experience.
          </div>
        </section>

        {/* Reading Theme */}
        <section>
          <FolioSectionHeader>Reading theme</FolioSectionHeader>
          <FolioRadioGroup
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

        {/* Typeface */}
        <section>
          <FolioSectionHeader>Typeface</FolioSectionHeader>
          <FolioRadioGroup
            label="Typeface"
            className="folio-wrap-row"
            value={prefs.fontFamily}
            options={TYPEFACE_OPTIONS.map((f) => ({
              value: f.value,
              label: f.label,
              style: {
                fontFamily: f.value === "publisher" ? SERIF_CSS : f.css,
              } as CSSProperties,
            }))}
            onChange={(fontFamily) => patch({ fontFamily })}
          />
        </section>

        {/* Text Size */}
        <section className="folio-appearance__group">
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

        {/* Line Spacing */}
        <section className="folio-appearance__group">
          <FolioSectionHeader>Line spacing</FolioSectionHeader>
          <div className="folio-slider-row">
            <input
              type="range"
              className="folio-slider"
              min={1.3}
              max={2.4}
              step={0.1}
              value={prefs.lineHeight}
              aria-label="Line spacing"
              aria-valuetext={`${prefs.lineHeight.toFixed(1)} times`}
              onChange={(e) =>
                patch({ lineHeight: clampLineHeight(Number(e.currentTarget.value)) })
              }
            />
            <span className="folio-control-value">{prefs.lineHeight.toFixed(1)}</span>
          </div>
        </section>

        {/* Text Alignment & Hyphenation */}
        <section className="folio-appearance__group">
          <FolioSectionHeader>Alignment & hyphenation</FolioSectionHeader>
          <div className="folio-toggle-row">
            <span>Justify text</span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.justify}
              className={`folio-switch${prefs.justify ? " is-on" : ""}`}
              onClick={() => patch({ justify: !prefs.justify })}
              aria-label="Justify text"
            >
              <span className="folio-switch__thumb" />
            </button>
          </div>
          <div className="folio-toggle-row">
            <span>Hyphenate</span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.hyphenate}
              className={`folio-switch${prefs.hyphenate ? " is-on" : ""}`}
              onClick={() => patch({ hyphenate: !prefs.hyphenate })}
              aria-label="Hyphenate"
            >
              <span className="folio-switch__thumb" />
            </button>
          </div>
        </section>

        {/* Margins */}
        <section className="folio-appearance__group">
          <FolioSectionHeader>Margins</FolioSectionHeader>
          <div className="folio-slider-row">
            <input
              type="range"
              className="folio-slider"
              min={12}
              max={64}
              step={1}
              value={prefs.margin}
              aria-label="Margins"
              aria-valuetext={`${prefs.margin} pixels`}
              onChange={(e) => patch({ margin: clampMargin(Number(e.currentTarget.value)) })}
            />
            <span className="folio-control-value">{prefs.margin}px</span>
          </div>
        </section>

        {/* Reading Width */}
        <section className="folio-appearance__group">
          <FolioSectionHeader>Reading width</FolioSectionHeader>
          <div className="folio-wrap-row">
            <FolioChip
              selected={prefs.maxWidth === 0}
              onClick={() => patch({ maxWidth: prefs.maxWidth === 0 ? 1040 : 0 })}
            >
              Full width
            </FolioChip>
          </div>
          <div className="folio-slider-row">
            <input
              type="range"
              className="folio-slider"
              min={480}
              max={1600}
              step={20}
              value={prefs.maxWidth > 0 ? prefs.maxWidth : 1040}
              disabled={prefs.maxWidth === 0}
              aria-label="Reading width"
              aria-valuetext={prefs.maxWidth > 0 ? `${prefs.maxWidth} pixels` : "full width"}
              onChange={(e) => patch({ maxWidth: clampMaxWidth(Number(e.currentTarget.value)) })}
            />
            <span className="folio-control-value">
              {prefs.maxWidth > 0 ? `${prefs.maxWidth}px` : "—"}
            </span>
          </div>
        </section>

        {/* Paragraph Spacing */}
        <section className="folio-appearance__group">
          <FolioSectionHeader>Paragraph spacing</FolioSectionHeader>
          <div className="folio-slider-row">
            <input
              type="range"
              className="folio-slider"
              min={0}
              max={0.8}
              step={0.01}
              value={prefs.paragraphSpacing}
              aria-label="Paragraph spacing"
              aria-valuetext={`${prefs.paragraphSpacing.toFixed(2)} em`}
              onChange={(e) =>
                patch({ paragraphSpacing: clampParagraphSpacing(Number(e.currentTarget.value)) })
              }
            />
            <span className="folio-control-value">{prefs.paragraphSpacing.toFixed(2)}</span>
          </div>
        </section>

        {/* Letter Spacing */}
        <section className="folio-appearance__group">
          <FolioSectionHeader>Letter spacing</FolioSectionHeader>
          <div className="folio-slider-row">
            <input
              type="range"
              className="folio-slider"
              min={0}
              max={0.1}
              step={0.01}
              value={prefs.letterSpacing}
              aria-label="Letter spacing"
              aria-valuetext={`${prefs.letterSpacing.toFixed(2)} em`}
              onChange={(e) =>
                patch({ letterSpacing: clampLetterSpacing(Number(e.currentTarget.value)) })
              }
            />
            <span className="folio-control-value">{prefs.letterSpacing.toFixed(2)}</span>
          </div>
        </section>

        {/* Page Flow */}
        <section className="folio-appearance__group">
          <FolioSectionHeader>Page flow</FolioSectionHeader>
          <FolioRadioGroup
            label="Page flow"
            className="folio-wrap-row"
            value={prefs.flow}
            options={[...FLOW_OPTIONS]}
            onChange={(flow) => patch({ flow })}
          />
        </section>

        {/* Brightness */}
        <section className="folio-appearance__group">
          <FolioSectionHeader>Brightness</FolioSectionHeader>
          <div className="folio-slider-row">
            <input
              type="range"
              className="folio-slider"
              min={30}
              max={100}
              step={1}
              value={prefs.brightness}
              aria-label="Brightness"
              aria-valuetext={`${prefs.brightness} percent`}
              onChange={(e) =>
                patch({ brightness: clampBrightness(Number(e.currentTarget.value)) })
              }
            />
            <span className="folio-control-value">{prefs.brightness}%</span>
          </div>
        </section>

        {/* Reset */}
        <section className="folio-appearance__reset">
          <FolioButton variant="secondary" onClick={onReset}>
            Reset to defaults
          </FolioButton>
          <p className="folio-helper">
            Removes this book's overrides and restores your global reading defaults.
          </p>
          <p className="folio-helper folio-helper--muted">
            Changes made inside a book stay with that book.
          </p>
        </section>
      </div>
    </FolioPanel>
  );
}
