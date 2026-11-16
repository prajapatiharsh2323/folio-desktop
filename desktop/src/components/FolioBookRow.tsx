import { FolioIcons } from "./FolioIcons";
import type { SourceFormat } from "../model/types";

export interface FolioBookRowData {
  id: string;
  title: string;
  author?: string;
  kind?: "Book" | "Article";
  /** Source format (PDF plan §5): "pdf" shows the PDF badge; others unbadged. */
  format?: SourceFormat;
  /** 0..1 */
  progress?: number;
  coverUrl?: string;
  /** Deterministic tint index (0–7) for placeholder art, by colorSeed. */
  tint?: number;
  /** L5: shelf badge — "New" for unopened books, "Finished" at 100%. */
  badge?: "New" | "Finished" | "Missing";
  /** L5: secondary line under the author (last read / time left). */
  metaLine?: string;
}

/** Accessible name for the row button. The PDF badge is visual only, so the
 *  format is spoken here instead (03 §5.2: names describe the control). */
function defaultRowLabel(data: FolioBookRowData): string {
  return data.format === "pdf" ? `Open ${data.title}, PDF` : `Open ${data.title}`;
}

const TINT_VARS = [
  "var(--folio-tint-sage-grey)",
  "var(--folio-tint-parchment)",
  "var(--folio-tint-eucalyptus)",
  "var(--folio-tint-clay)",
  "var(--folio-tint-slate)",
  "var(--folio-tint-oat)",
  "var(--folio-tint-stone)",
  "var(--folio-tint-moss)",
];

/** Library row (03 §5.2): 56×78 r4 cover + title/author + kind + trailing % + 3px line.
 * The row body is a real button; the optional "…" action is a sibling control so
 * no interactive element is ever nested inside another.
 * `variant="card"` is the L5 grid tile: cover on top, title/author below. */
export function FolioBookRow({
  data,
  onOpen,
  onMore,
  actionLabel,
  variant = "row",
}: {
  data: FolioBookRowData;
  onOpen?: (id: string) => void;
  /** ⋯ action; `trigger` is the button element, for anchored menus (L4). */
  onMore?: (id: string, trigger: HTMLElement) => void;
  /** Overrides the row button's accessible name (e.g. selection mode). */
  actionLabel?: string;
  variant?: "row" | "card";
}) {
  const pct = Math.round((data.progress ?? 0) * 100);
  const initials = data.title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const tint = TINT_VARS[(data.tint ?? 0) % TINT_VARS.length];
  const card = variant === "card";

  const cover = (
    <div className="folio-book-row__cover" style={{ background: tint }}>
      {data.coverUrl ? (
        // Native lazy decode/repaint: offscreen covers don't decode until
        // they scroll into view (L3).
        <img src={data.coverUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        initials || <FolioIcons.Book />
      )}
    </div>
  );

  const badge = data.badge && (
    <span className={`folio-book-row__badge folio-book-row__badge--${data.badge.toLowerCase()}`}>
      {data.badge}
    </span>
  );

  const meta = (
    <div className="folio-book-row__meta">
      <div className="folio-book-row__title">
        {data.title}
        {badge}
      </div>
      {data.author && <div className="folio-book-row__author">{data.author}</div>}
      {(data.kind || data.format === "pdf") && (
        <div className="folio-book-row__author">
          {data.kind}
          {data.format === "pdf" && <span className="folio-badge folio-badge--pdf">PDF</span>}
        </div>
      )}
      {data.metaLine && <div className="folio-book-row__metaline">{data.metaLine}</div>}
    </div>
  );

  if (card) {
    return (
      <div className="folio-book-card">
        {onOpen ? (
          <button
            type="button"
            className="folio-book-card__open"
            onClick={() => onOpen(data.id)}
            aria-label={actionLabel ?? `Open ${data.title}`}
          >
            {cover}
            <span className="folio-book-card__title">{data.title}</span>
            {(data.author || data.badge) && (
              <span className="folio-book-card__author">
                {data.badge ? `${data.badge} · ` : ""}
                {data.author ?? data.kind}
              </span>
            )}
            {data.progress !== undefined && (
              <span className="folio-book-card__progress" aria-hidden="true">
                <span className="folio-book-row__progress-fill" style={{ width: `${pct}%` }} />
              </span>
            )}
          </button>
        ) : (
          <div className="folio-book-card__open">{cover}</div>
        )}
        {onMore && (
          <button
            type="button"
            className="folio-iconbtn folio-book-row__more folio-book-card__more"
            aria-label={`Actions for ${data.title}`}
            onClick={(e) => onMore(data.id, e.currentTarget)}
          >
            <FolioIcons.More size="sm" />
          </button>
        )}
      </div>
    );
  }

  const body = (
    <>
      {cover}
      {meta}
      <div className="folio-book-row__trailing">
        {data.progress !== undefined && (
          <>
            <span className="folio-book-row__progress-label">{pct}%</span>
            <div className="folio-book-row__progress" aria-hidden="true">
              <div className="folio-book-row__progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="folio-book-row">
      {onOpen ? (
        <button
          type="button"
          className="folio-book-row__open"
          onClick={() => onOpen(data.id)}
          aria-label={actionLabel ?? defaultRowLabel(data)}
        >
          {body}
        </button>
      ) : (
        <div className="folio-book-row__open">{body}</div>
      )}
      {onMore && (
        <button
          type="button"
          className="folio-iconbtn folio-book-row__more"
          aria-label={`Actions for ${data.title}`}
          onClick={(e) => onMore(data.id, e.currentTarget)}
        >
          <FolioIcons.More size="sm" />
        </button>
      )}
    </div>
  );
}
