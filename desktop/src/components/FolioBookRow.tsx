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
 * Hover: surface-subtle background and a visible "…" button. */
export function FolioBookRow({
  data,
  onOpen,
  onMore,
}: {
  data: FolioBookRowData;
  onOpen?: (id: string) => void;
  onMore?: (id: string) => void;
}) {
  const pct = Math.round((data.progress ?? 0) * 100);
  const initials = data.title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const tint = TINT_VARS[(data.tint ?? 0) % TINT_VARS.length];

  return (
    <div
      className="folio-book-row"
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={() => onOpen?.(data.id)}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === "Enter") onOpen(data.id);
            }
          : undefined
      }
    >
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
        <button
          type="button"
          className="folio-iconbtn folio-book-row__more"
          aria-label={`Actions for ${data.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onMore?.(data.id);
          }}
        >
          <FolioIcons.More size="sm" />
        </button>
      </div>
    </div>
  );
}
