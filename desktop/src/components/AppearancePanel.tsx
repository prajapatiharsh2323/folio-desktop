import { useMemo, type CSSProperties } from "react";
import { FolioButton } from "./FolioButton";
import { FolioPanel } from "./FolioPanel";
import { FolioRadioGroup } from "./FolioRadioGroup";
import {
  AppearancePanelFooter,
  AppearanceSection,
  AppearanceSwitchRow,
} from "./appearancePrimitives";
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
import type { ReadingPrefs, ReadingSpread } from "../model/types";
import type { ReaderCapabilities } from "../reader/ReaderEngine";
import { MAX_ZOOM, MIN_ZOOM } from "../pdf/pdfLayout";
import { EPUB_THEME_OPTIONS, TYPEFACE_OPTIONS } from "./readingPrefsOptions";
import { resolveReaderTheme } from "../reader/readerThemes";

const SERIF_CSS = '"Iowan Old Style", Georgia, serif';
const FLOW_OPTIONS = [
  { value: "paginated", label: "Paginated" },
  { value: "scrolled", label: "Scrolled" },
] as const;

const SPREAD_OPTIONS = [
  { value: "none", label: "Single pages" },
  { value: "auto", label: "Auto" },
  { value: "both", label: "Spreads" },
] as const;

const WIDTH_PRESETS: { label: string; value: number }[] = [
  { label: "Compact", value: 640 },
  { label: "Standard", value: 880 },
  { label: "Wide", value: 1120 },
  { label: "Full width", value: 0 },
];

interface AppearancePanelProps {
  open: boolean;
  /**
   * Non-modal by default from R8: docked without a scrim so the user sees
   * type/theme changes applied to the canvas behind the panel while tuning.
   */
  modal?: boolean;
  prefs: ReadingPrefs;
  onClose: () => void;
  onChange: (next: ReadingPrefs) => void;
  /** removes this book's override, restoring the global defaults (04 §3) */
  onReset: () => void;
  /** Engine capability report (PDF plan §8.4). Undefined ⇒ reflowable with
   *  typography, which renders exactly today's EPUB panel. Fixed-layout
   *  documents get zoom + page-layout sections instead of typography. */
  capabilities?: ReaderCapabilities;
  /** Current zoom (fit mode or absolute); shown in the zoom controls. */
  zoom?: "fit-width" | "fit-page" | number;
  /** Zoom stepping goes to the engine: zoom is session state, not a pref. */
  onZoomBy?: (direction: 1 | -1) => void;
  onZoomMode?: (mode: "fit-width" | "fit-page") => void;
  /** OS dark flag, passed in so the System swatch/preview updates on a flip. */
  systemDark?: boolean;
  /** Additive "Publisher" presentation (leaves author colours untouched). */
  respectPublisherColors?: boolean;
  onPublisherColorsChange?: (value: boolean) => void;
}

/**
 * EPUB appearance panel (04 §3): per-book ReadingPrefs, right-anchored and
 * non-modal. Sections: Reading theme → Quick adjustments → Typography →
 * Page layout → (collapsible) Advanced spacing, with a sticky reset footer.
 */
export function EpubAppearancePanel({
  open,
  modal = false,
  prefs,
  onClose,
  onChange,
  onReset,
  capabilities,
  zoom = "fit-width",
  onZoomBy,
  onZoomMode,
  systemDark = false,
  respectPublisherColors = false,
  onPublisherColorsChange,
}: AppearancePanelProps) {
  const patch = (part: Partial<ReadingPrefs>) => onChange({ ...prefs, ...part });
  /** Fixed layout: no typography sections, zoom + page layout instead (§8.4). */
  const fixed = capabilities?.format === "fixed";
  const zoomLabel =
    zoom === "fit-width"
      ? "Fit width"
      : zoom === "fit-page"
        ? "Fit page"
        : `${Math.round(zoom * 100)}%`;

  const activeFont =
    prefs.fontFamily === "publisher"
      ? { ...TYPEFACE_OPTIONS[0], css: SERIF_CSS }
      : (TYPEFACE_OPTIONS.find((f) => f.value === prefs.fontFamily) ?? TYPEFACE_OPTIONS[0]);
  const previewColors = useMemo(() => {
    // Route through the canonical resolver AND take systemDark as a prop: a
    // System flip must repaint the preview as well as the canvas.
    const resolved = resolveReaderTheme(prefs.theme, systemDark);
    if (respectPublisherColors) {
      return {
        bg: "#FFFFFF",
        text: "#121212",
        selectionBg: "#FFD27F",
        selectionText: "#121212",
      };
    }
    return {
      bg: resolved.pageBg,
      text: resolved.pageText,
      selectionBg: resolved.selectionBg,
      selectionText: resolved.selectionText,
    };
  }, [prefs.theme, systemDark, respectPublisherColors]);

  // Presets are approximate: a width set with the slider still shows the
  // nearest preset as active so the quick row never looks unselected.
  const widthPreset =
    prefs.maxWidth === 0
      ? "0"
      : (WIDTH_PRESETS.find(
          (p) => p.value > 0 && Math.abs(prefs.maxWidth - p.value) <= 40,
        )?.value.toString() ?? "");

  return (
    <FolioPanel open={open} onClose={onClose} title="Appearance" width={400} modal={modal}>
      <div className="folio-appearance">
        <AppearanceSection
          title="Reading theme"
          description={
            respectPublisherColors
              ? "Publisher keeps the book's original colours. Contrast may differ from Folio's themes; pick any other theme to take control again."
              : "Publisher preserves the book's original colours instead of applying a Folio palette."
          }
        >
          <FolioRadioGroup
            label="Reading theme"
            className="folio-theme-grid"
            value={respectPublisherColors ? "publisher" : prefs.theme}
            options={EPUB_THEME_OPTIONS}
            onChange={(value) => {
              if (value === "publisher") {
                onPublisherColorsChange?.(true);
              } else {
                onPublisherColorsChange?.(false);
                patch({ theme: value });
              }
            }}
            renderOption={({ option, selected, tabIndex, select, setButton }) => {
              const publisher = option.value === "publisher";
              const colors = publisher
                ? { bg: "#FFFFFF", text: "#121212" }
                : READER_THEME_COLORS[option.value];
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
        </AppearanceSection>

        <AppearanceSection title="Quick adjustments">
          <div className="folio-appearance__quick-card">
            <div className="folio-appearance__quick-row">
              {fixed ? (
                <div
                  className="folio-appearance__quick-stepper"
                  role="group"
                  aria-label="Page zoom"
                >
                  <button
                    type="button"
                    className="folio-appearance__quick-btn"
                    aria-label="Zoom out"
                    disabled={typeof zoom === "number" && zoom <= MIN_ZOOM}
                    onClick={() => onZoomBy?.(-1)}
                  >
                    −
                  </button>
                  <span className="folio-appearance__quick-size" aria-live="polite">
                    {zoomLabel}
                  </span>
                  <button
                    type="button"
                    className="folio-appearance__quick-btn"
                    aria-label="Zoom in"
                    disabled={typeof zoom === "number" && zoom >= MAX_ZOOM}
                    onClick={() => onZoomBy?.(1)}
                  >
                    +
                  </button>
                </div>
              ) : (
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
              )}
            </div>

            {!fixed && (
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
            )}
          </div>
        </AppearanceSection>

        {/* Typography preview sits directly above the controls that shape it. */}
        {!fixed && (
          <AppearanceSection title="Typography preview">
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
              deliver an immersive,{" "}
              <span
                style={{
                  backgroundColor: previewColors.selectionBg,
                  color: previewColors.selectionText,
                }}
              >
                selection-coloured
              </span>{" "}
              reading experience.
            </div>
          </AppearanceSection>
        )}

        {!fixed && (
          <>
            <AppearanceSection title="Typography">
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
              <AppearanceSwitchRow
                label="Justify text"
                ariaLabel="Justify text"
                checked={prefs.justify}
                onChange={() => patch({ justify: !prefs.justify })}
              />
              <AppearanceSwitchRow
                label="Hyphenate"
                ariaLabel="Hyphenate"
                checked={prefs.hyphenate}
                onChange={() => patch({ hyphenate: !prefs.hyphenate })}
              />
            </AppearanceSection>

            <details className="folio-appearance__advanced">
              <summary>Advanced spacing</summary>
              <div className="folio-appearance__advanced-body">
                <AppearanceSection title="Margins">
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
                      onChange={(e) =>
                        patch({ margin: clampMargin(Number(e.currentTarget.value)) })
                      }
                    />
                    <span className="folio-control-value">{prefs.margin}px</span>
                  </div>
                </AppearanceSection>

                <AppearanceSection title="Reading width">
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
                      aria-valuetext={
                        prefs.maxWidth > 0 ? `${prefs.maxWidth} pixels` : "full width"
                      }
                      onChange={(e) =>
                        patch({ maxWidth: clampMaxWidth(Number(e.currentTarget.value)) })
                      }
                    />
                    <span className="folio-control-value">
                      {prefs.maxWidth > 0 ? `${prefs.maxWidth}px` : "—"}
                    </span>
                  </div>
                </AppearanceSection>

                <AppearanceSection title="Paragraph spacing">
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
                        patch({
                          paragraphSpacing: clampParagraphSpacing(Number(e.currentTarget.value)),
                        })
                      }
                    />
                    <span className="folio-control-value">{prefs.paragraphSpacing.toFixed(2)}</span>
                  </div>
                </AppearanceSection>

                <AppearanceSection title="Letter spacing">
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
                </AppearanceSection>
              </div>
            </details>
          </>
        )}

        <AppearanceSection title="Page layout">
          <FolioRadioGroup
            label="Page flow"
            className="folio-wrap-row"
            value={prefs.flow}
            options={[...FLOW_OPTIONS]}
            onChange={(flow) => patch({ flow })}
          />
          {(prefs.flow === "paginated" || fixed) && (
            <>
              <FolioRadioGroup
                label="Page layout"
                className="folio-wrap-row"
                value={prefs.spread}
                options={SPREAD_OPTIONS.map((o) => ({ ...o }))}
                onChange={(spread) => patch({ spread: spread as ReadingSpread })}
              />
              <p className="folio-helper folio-helper--muted">
                Auto shows two-page spreads when the window is wide enough.
              </p>
            </>
          )}
          {fixed && (
            <FolioRadioGroup
              label="Zoom mode"
              className="folio-wrap-row"
              value={typeof zoom === "string" ? zoom : ""}
              options={[
                { value: "fit-width", label: "Fit width" },
                { value: "fit-page", label: "Fit page" },
              ]}
              onChange={(mode) => onZoomMode?.(mode as "fit-width" | "fit-page")}
            />
          )}
        </AppearanceSection>

        <AppearanceSection title="Brightness">
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
        </AppearanceSection>

        <AppearancePanelFooter>
          <FolioButton variant="secondary" onClick={onReset}>
            Reset to defaults
          </FolioButton>
          <p className="folio-helper">
            Removes this book's overrides and restores your global reading defaults.
          </p>
        </AppearancePanelFooter>
      </div>
    </FolioPanel>
  );
}

/** Back-compatible name — the reflowable panel was the original AppearancePanel. */
export const AppearancePanel = EpubAppearancePanel;
