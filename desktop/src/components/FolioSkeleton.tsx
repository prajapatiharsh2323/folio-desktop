// X2 (Phase 4): skeleton loading rows.
//
// Placeholder book rows / cover cards shown while the library, collections or
// notes load — the layout is already final, so content never shifts in. The
// shimmer is pure CSS and dies under `prefers-reduced-motion` (components.css
// keeps the same media pattern as every other animation in the app).

import { t, useLocaleStore } from "../i18n/i18n";

export type SkeletonView = "list" | "grid";

interface FolioSkeletonRowsProps {
  rows?: number;
  view?: SkeletonView;
}

/** A single list-row placeholder: cover block + two text bars. */
function SkeletonRow() {
  return (
    <div className="folio-skeleton-row" aria-hidden="true">
      <div className="folio-skeleton-cover" />
      <div className="folio-skeleton-lines">
        <div className="folio-skeleton-bar folio-skeleton-bar--title" />
        <div className="folio-skeleton-bar folio-skeleton-bar--meta" />
      </div>
    </div>
  );
}

/** A single grid-card placeholder: tall cover + caption bar. */
function SkeletonCard() {
  return (
    <div className="folio-skeleton-card" aria-hidden="true">
      <div className="folio-skeleton-cover folio-skeleton-cover--tall" />
      <div className="folio-skeleton-bar folio-skeleton-bar--title" />
      <div className="folio-skeleton-bar folio-skeleton-bar--meta" />
    </div>
  );
}

export function FolioSkeletonRows({ rows = 8, view = "list" }: FolioSkeletonRowsProps) {
  // Subscribed so a locale change re-renders the sr-only label (X5).
  const locale = useLocaleStore((s) => s.locale);
  return (
    <div className={`folio-skeleton folio-skeleton--${view}`} role="status" aria-busy="true">
      <span className="folio-visually-hidden">{t("common.loading", locale)}</span>
      {view === "grid"
        ? Array.from({ length: rows }, (_, i) => <SkeletonCard key={i} />)
        : Array.from({ length: rows }, (_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}
