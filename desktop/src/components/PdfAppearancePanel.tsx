// Fixed-layout (PDF) appearance panel. Deliberately contains no reflowable
// typography controls — zoom, rotation, page arrangement and page presentation
// belong here, and none of these values live in the schema-1 ReadingPrefs.
import { FolioButton } from "./FolioButton";
import { FolioPanel } from "./FolioPanel";
import { FolioRadioGroup } from "./FolioRadioGroup";
import { FolioSectionHeader } from "./FolioSectionHeader";
import {
  AppearancePanelFooter,
  AppearanceSection,
  AppearanceSwitchRow,
} from "./appearancePrimitives";
import { clampBrightness } from "../model/defaults";
import type { PdfReaderPrefs, PdfRotation } from "../model/formatPrefs";
import type { ReaderPageInfo } from "../reader/ReaderEngine";
import { MAX_ZOOM, MIN_ZOOM } from "../pdf/pdfLayout";
import { READING_THEME_OPTIONS } from "./readingPrefsOptions";

interface PdfAppearancePanelProps {
  open: boolean;
  modal?: boolean;
  prefs: PdfReaderPrefs;
  zoom: "fit-width" | "fit-page" | number;
  pageInfo?: ReaderPageInfo | null;
  onClose: () => void;
  onChange: (next: PdfReaderPrefs) => void;
  onReset: () => void;
  onZoomBy: (direction: 1 | -1) => void;
  onZoomMode: (mode: "fit-width" | "fit-page") => void;
  onZoomActual: () => void;
  onGoPage: (page: number) => void;
}

const ARRANGEMENT_OPTIONS = [
  { value: "none", label: "Single page" },
  { value: "both", label: "Facing pages" },
  { value: "auto", label: "Auto" },
] as const;
const PRESENTATION_OPTIONS = [
  { value: "original", label: "Original" },
  { value: "warm", label: "Warm" },
  { value: "dim", label: "Dim" },
  { value: "night", label: "Night" },
] as const;
const DIRECTION_OPTIONS = [
  { value: "ltr", label: "Left to right" },
  { value: "rtl", label: "Right to left" },
] as const;
const ROTATION_OPTIONS = [
  { value: "0", label: "0°" },
  { value: "90", label: "90°" },
  { value: "180", label: "180°" },
  { value: "270", label: "270°" },
] as const;
const BACKGROUND_OPTIONS = [
  { value: "theme", label: "Theme" },
  { value: "neutral", label: "Neutral" },
  { value: "black", label: "Black" },
] as const;

export function PdfAppearancePanel({
  open,
  modal = false,
  prefs,
  zoom,
  pageInfo,
  onClose,
  onChange,
  onReset,
  onZoomBy,
  onZoomMode,
  onZoomActual,
  onGoPage,
}: PdfAppearancePanelProps) {
  const patch = (part: Partial<PdfReaderPrefs>) => onChange({ ...prefs, ...part });
  const zoomLabel =
    zoom === "fit-width"
      ? "Fit width"
      : zoom === "fit-page"
        ? "Fit page"
        : `${Math.round(zoom * 100)}%`;

  return (
    <FolioPanel open={open} onClose={onClose} title="Page appearance" width={400} modal={modal}>
      <div className="folio-appearance">
        <AppearanceSection title="Appearance">
          <FolioRadioGroup
            label="Reading theme"
            className="folio-theme-grid"
            value={prefs.theme}
            options={READING_THEME_OPTIONS}
            onChange={(theme) => patch({ theme })}
          />
          <FolioSectionHeader>Page presentation</FolioSectionHeader>
          <FolioRadioGroup
            label="Page presentation"
            className="folio-wrap-row"
            value={prefs.presentation}
            options={[...PRESENTATION_OPTIONS]}
            onChange={(presentation) => patch({ presentation })}
          />
          <p className="folio-helper folio-helper--muted">
            Applies to the paper itself; the surrounding workspace follows the reading theme.
          </p>
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
          <FolioSectionHeader>Surrounding background</FolioSectionHeader>
          <FolioRadioGroup
            label="Surrounding background"
            className="folio-wrap-row"
            value={prefs.background}
            options={[...BACKGROUND_OPTIONS]}
            onChange={(background) => patch({ background })}
          />
        </AppearanceSection>

        <AppearanceSection title="Zoom & navigation">
          <div className="folio-appearance__quick-card">
            <div className="folio-appearance__quick-row">
              <div className="folio-appearance__quick-stepper" role="group" aria-label="Page zoom">
                <button
                  type="button"
                  className="folio-appearance__quick-btn"
                  aria-label="Zoom out"
                  disabled={typeof zoom === "number" && zoom <= MIN_ZOOM}
                  onClick={() => onZoomBy(-1)}
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
                  onClick={() => onZoomBy(1)}
                >
                  +
                </button>
              </div>
              {pageInfo && (
                <div
                  className="folio-appearance__quick-stepper"
                  role="group"
                  aria-label="Go to page"
                >
                  <label className="folio-helper" htmlFor="folio-pdf-page-number">
                    Page
                  </label>
                  <input
                    id="folio-pdf-page-number"
                    type="number"
                    min={1}
                    max={pageInfo.pageCount}
                    value={pageInfo.page}
                    onChange={(e) => {
                      const page = Number(e.currentTarget.value);
                      if (Number.isFinite(page)) onGoPage(page);
                    }}
                  />
                  <span className="folio-control-value">/ {pageInfo.pageCount}</span>
                </div>
              )}
            </div>
          </div>
          <FolioRadioGroup
            label="Zoom mode"
            className="folio-wrap-row"
            value={typeof zoom === "string" ? zoom : "fit-width"}
            options={[
              { value: "fit-width", label: "Fit width" },
              { value: "fit-page", label: "Fit page" },
            ]}
            onChange={(mode) => onZoomMode(mode)}
          />
          <FolioButton variant="secondary" onClick={onZoomActual}>
            Actual size
          </FolioButton>
          <p className="folio-helper folio-helper--muted">
            Zoom in/out above adjusts a custom size; fit modes keep the whole page or spread in
            view.
          </p>
        </AppearanceSection>

        <AppearanceSection title="Page layout">
          <FolioRadioGroup
            label="Page display mode"
            className="folio-wrap-row"
            value={prefs.flow}
            options={[
              { value: "paginated", label: "Paginated" },
              { value: "scrolled", label: "Continuous" },
            ]}
            onChange={(flow) => patch({ flow })}
          />
          <FolioSectionHeader>Page arrangement</FolioSectionHeader>
          <FolioRadioGroup
            label="Page arrangement"
            className="folio-wrap-row"
            value={prefs.spread}
            options={[...ARRANGEMENT_OPTIONS]}
            onChange={(spread) => patch({ spread })}
          />
          <FolioRadioGroup
            label="Reading direction"
            className="folio-wrap-row"
            value={prefs.direction}
            options={[...DIRECTION_OPTIONS]}
            onChange={(direction) => patch({ direction })}
          />
          <AppearanceSwitchRow
            label="Cover-first spreads"
            ariaLabel="Cover-first spreads"
            checked={prefs.coverFirst}
            onChange={() => patch({ coverFirst: !prefs.coverFirst })}
            description="Cover on its own in facing-page mode"
          />
        </AppearanceSection>

        <AppearanceSection title="Page adjustments">
          <FolioSectionHeader>Page rotation</FolioSectionHeader>
          <FolioRadioGroup
            label="Page rotation"
            className="folio-wrap-row"
            value={String(prefs.rotation)}
            options={[...ROTATION_OPTIONS]}
            onChange={(value) => patch({ rotation: Number(value) as PdfRotation })}
          />
          <div className="folio-slider-row">
            <input
              type="range"
              className="folio-slider"
              min={0}
              max={64}
              step={4}
              value={prefs.pageSpacing}
              aria-label="Page spacing"
              onChange={(e) => patch({ pageSpacing: Number(e.currentTarget.value) })}
            />
            <span className="folio-control-value">{prefs.pageSpacing}px</span>
          </div>
        </AppearanceSection>

        <AppearanceSection title="Workspace">
          <AppearanceSwitchRow
            label="Page thumbnails"
            ariaLabel="Show page thumbnails"
            checked={prefs.thumbnails}
            onChange={() => patch({ thumbnails: !prefs.thumbnails })}
          />
          <AppearanceSwitchRow
            label="Hand / pan tool"
            ariaLabel="Hand / pan tool"
            checked={prefs.pan}
            onChange={() => patch({ pan: !prefs.pan })}
            description="Drag to move when zoomed"
          />
          <AppearanceSwitchRow
            label="Page-number navigation"
            ariaLabel="Show page number"
            checked={prefs.pageNumber}
            onChange={() => patch({ pageNumber: !prefs.pageNumber })}
          />
          <AppearanceSwitchRow
            label="Full-screen focus workspace"
            ariaLabel="Full-screen focus workspace"
            checked={prefs.focusWorkspace}
            onChange={() => patch({ focusWorkspace: !prefs.focusWorkspace })}
          />
        </AppearanceSection>

        <AppearancePanelFooter>
          <FolioButton variant="secondary" onClick={onReset}>
            Reset PDF appearance
          </FolioButton>
          <p className="folio-helper">
            Restores your global PDF defaults only. EPUB typography is not affected.
          </p>
        </AppearancePanelFooter>
      </div>
    </FolioPanel>
  );
}
