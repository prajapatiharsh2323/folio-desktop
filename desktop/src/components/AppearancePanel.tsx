import type { CSSProperties } from "react";
import { FolioButton } from "./FolioButton";
import { FolioChip } from "./FolioChip";
import { FolioPanel } from "./FolioPanel";
import { FolioSectionHeader } from "./FolioSectionHeader";
import {
  clampBrightness,
  clampFontSize,
  clampLetterSpacing,
  clampLineHeight,
  clampMargin,
  clampParagraphSpacing,
  READER_THEME_COLORS,
} from "../model/defaults";
import type {
  FontFamilyPref,
  ReadingPrefs,
  ReadingTheme,
} from "../model/types";

const THEMES: { value: ReadingTheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "warm", label: "Paper" },
  { value: "dark", label: "Dark" },
  { value: "true-black", label: "True black" },
  { value: "system", label: "System" },
];

const TYPEFACES: { value: FontFamilyPref; label: string; css: string }[] = [
  { value: "serif", label: "Serif", css: '"Iowan Old Style", Georgia, serif' },
  { value: "sans", label: "Sans", css: '"Segoe UI", system-ui, sans-serif' },
  { value: "mono", label: "Mono", css: '"Cascadia Code", Consolas, monospace' },
  { value: "publisher", label: "Publisher", css: "var(--folio-font-display)" },
];

interface AppearancePanelProps {
  open: boolean;
  prefs: ReadingPrefs;
  onClose: () => void;
  onChange: (next: ReadingPrefs) => void;
  /** removes this book's override, restoring the global defaults (04 §3) */
  onReset: () => void;
}

/** Appearance panel (04 §3): per-book ReadingPrefs, app theme, right-anchored. */
export function AppearancePanel({
  open,
  prefs,
  onClose,
  onChange,
  onReset,
}: AppearancePanelProps) {
  const patch = (part: Partial<ReadingPrefs>) => onChange({ ...prefs, ...part });

  return (
    <FolioPanel open={open} onClose={onClose} title="Appearance">
      <div className="folio-appearance">
        <section>
          <FolioSectionHeader>Reading theme</FolioSectionHeader>
          <div className="folio-theme-grid" role="radiogroup" aria-label="Reading theme">
            {THEMES.map((t) => {
              const colors = READER_THEME_COLORS[t.value];
              const selected = prefs.theme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`folio-theme-swatch${selected ? " is-selected" : ""}`}
                  onClick={() => patch({ theme: t.value })}
                >
                  <span
                    className="folio-theme-swatch__page"
                    style={{ background: colors.bg, color: colors.text }}
                    aria-hidden="true"
                  >
                    Aa
                  </span>
                  <span className="folio-theme-swatch__label">{t.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <FolioSectionHeader>Typeface</FolioSectionHeader>
          <div className="folio-wrap-row" role="radiogroup" aria-label="Typeface">
            {TYPEFACES.map((f) => (
              <FolioChip
                key={f.value}
                selected={prefs.fontFamily === f.value}
                asRadio
                style={{ fontFamily: f.css } as CSSProperties}
                onClick={() => patch({ fontFamily: f.value })}
              >
                {f.label}
              </FolioChip>
            ))}
          </div>
        </section>

        <section className="folio-appearance__group">
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
              onChange={(e) => patch({ lineHeight: clampLineHeight(Number(e.currentTarget.value)) })}
            />
            <span className="folio-control-value">{prefs.lineHeight.toFixed(1)}</span>
          </div>
        </section>

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

        <section className="folio-appearance__group">
          <FolioSectionHeader>Layout</FolioSectionHeader>
          <div className="folio-wrap-row" role="radiogroup" aria-label="Layout">
            <FolioChip
              selected={prefs.flow === "paginated"}
              asRadio
              onClick={() => patch({ flow: "paginated" })}
            >
              Paginated
            </FolioChip>
            <FolioChip
              selected={prefs.flow === "scrolled"}
              asRadio
              onClick={() => patch({ flow: "scrolled" })}
            >
              Scrolled
            </FolioChip>
          </div>
          <div className="folio-toggle-row">
            <span>Justify text</span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.justify}
              className={`folio-switch${prefs.justify ? " is-on" : ""}`}
              onClick={() => patch({ justify: !prefs.justify })}
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
            >
              <span className="folio-switch__thumb" />
            </button>
          </div>
        </section>

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
              onChange={(e) => patch({ brightness: clampBrightness(Number(e.currentTarget.value)) })}
            />
            <span className="folio-control-value">{prefs.brightness}%</span>
          </div>
        </section>

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
