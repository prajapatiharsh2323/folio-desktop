import { FolioIcons } from "./FolioIcons";

export interface FolioBookRowData {
  id: string;
  title: string;
  author?: string;
  kind?: "Book" | "Article";
  /** 0..1 */
  progress?: number;
  coverUrl?: string;
  /** Deterministic tint index (0–7) for placeholder art, by colorSeed. */
  tint?: number;
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
 * no interactive element is ever nested inside another. */
export function FolioBookRow({
  data,
  onOpen,
  onMore,
  actionLabel,
}: {
  data: FolioBookRowData;
  onOpen?: (id: string) => void;
  onMore?: (id: string) => void;
  /** Overrides the row button's accessible name (e.g. selection mode). */
  actionLabel?: string;
}) {
  const pct = Math.round((data.progress ?? 0) * 100);
  const initials = data.title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const tint = TINT_VARS[(data.tint ?? 0) % TINT_VARS.length];

  const body = (
    <>
      <div className="folio-book-row__cover" style={{ background: tint }}>
        {data.coverUrl ? <img src={data.coverUrl} alt="" /> : initials || <FolioIcons.Book />}
      </div>
      <div className="folio-book-row__meta">
        <div className="folio-book-row__title">{data.title}</div>
        {data.author && <div className="folio-book-row__author">{data.author}</div>}
        {data.kind && <div className="folio-book-row__author">{data.kind}</div>}
      </div>
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
          aria-label={actionLabel ?? `Open ${data.title}`}
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
          onClick={() => onMore(data.id)}
        >
          <FolioIcons.More size="sm" />
        </button>
      )}
    </div>
  );
}
