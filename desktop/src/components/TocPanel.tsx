import { FolioPanel } from "./FolioPanel";
import type { TocEntry } from "../reader/ReaderEngine";

interface TocPanelProps {
  open: boolean;
  entries: TocEntry[];
  /** current chapter href (fragment-insensitive) */
  currentHref?: string | null;
  onClose: () => void;
  onSelect: (href: string) => void;
}

function withoutFragment(href: string): string {
  return href.split("#")[0];
}

function decoded(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** Tolerant chapter-href comparison: entries, the locator and the stored
 * meta can carry different encodings/leading directories for one chapter.
 * Mirrors the comparison ReaderScreen applies to saved locations. */
export function tocHrefMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = decoded(withoutFragment(a));
  const y = decoded(withoutFragment(b));
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

/** Table of contents panel (03 §5.3/§5.4): 360px, section-maintains. */
export function TocPanel({ open, entries, currentHref, onClose, onSelect }: TocPanelProps) {
  return (
    <FolioPanel open={open} onClose={onClose} title="Contents">
      {entries.length === 0 ? (
        <p className="folio-helper">This book has no table of contents.</p>
      ) : (
        <nav aria-label="Table of contents">
          <ul className="folio-toc">
            {entries.map((entry, i) => {
              const active = tocHrefMatches(entry.href, currentHref);
              return (
                <li key={`${entry.href}-${i}`}>
                  <button
                    type="button"
                    className={`folio-toc__item${active ? " is-current" : ""}`}
                    style={{ paddingLeft: `calc(var(--folio-space-3) + ${entry.depth} * var(--folio-space-4))` }}
                    aria-current={active ? "location" : undefined}
                    onClick={() => {
                      onSelect(entry.href);
                      onClose();
                    }}
                  >
                    {entry.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </FolioPanel>
  );
}
