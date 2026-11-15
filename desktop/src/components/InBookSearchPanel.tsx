import { useState } from "react";
import { FolioPanel } from "./FolioPanel";
import { FolioIcons } from "./FolioIcons";
import { handleError } from "../lib/errorLog";
import type { SnippetParts } from "../search/occurrences";

interface SearchHit {
  chapterTitle: string;
  snippet: SnippetParts;
  locator: string;
}

interface InBookSearchPanelProps {
  open: boolean;
  query: string;
  results: SearchHit[];
  /** index of the match the panel is currently on (-1 = none yet) */
  activeIndex: number;
  isSearching: boolean;
  searchError?: string | null;
  onQueryChange: (query: string) => void;
  onClear: () => void;
  onClose: () => void;
  onSelectResult: (hit: SearchHit, index: number) => Promise<unknown> | void;
  onNext: () => void;
  onPrev: () => void;
}

/** One chapter group: consecutive hits sharing the same chapter. */
interface ChapterGroup {
  title: string;
  locator: string;
  first: number;
  hits: Array<{ hit: SearchHit; index: number }>;
}

function groupByChapter(results: SearchHit[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  for (let i = 0; i < results.length; i++) {
    const hit = results[i];
    const last = groups[groups.length - 1];
    if (last && last.title === hit.chapterTitle) {
      last.hits.push({ hit, index: i });
    } else {
      groups.push({
        title: hit.chapterTitle,
        locator: hit.locator,
        first: i,
        hits: [{ hit, index: i }],
      });
    }
  }
  return groups;
}

/**
 * In-Book Search Panel:
 * Fast, debounced text search across EPUB chapters with per-occurrence
 * results grouped by chapter, a "current of total" counter, Next/Prev
 * (Enter/Shift+Enter/F3), and a panel that stays open so the user can step
 * through matches.
 */
export function InBookSearchPanel({
  open,
  query,
  results,
  activeIndex,
  isSearching,
  searchError = null,
  onQueryChange,
  onClear,
  onClose,
  onSelectResult,
  onNext,
  onPrev,
}: InBookSearchPanelProps) {
  const [resolvingIndex, setResolvingIndex] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSelect = async (hit: SearchHit, index: number) => {
    if (resolvingIndex !== null) return;
    setResolvingIndex(index);
    setErrorMessage(null);
    try {
      const outcome = await onSelectResult(hit, index);
      if (
        outcome &&
        typeof outcome === "object" &&
        "ok" in outcome &&
        !(outcome as { ok: boolean }).ok &&
        !("superseded" in outcome && (outcome as { superseded: boolean }).superseded)
      ) {
        setErrorMessage("Couldn't reach that search location.");
      }
      // Success keeps the panel open: the user steps through matches.
    } catch (e) {
      handleError(e, { context: "reader.search.navigate" });
      setErrorMessage("Couldn't reach that search location.");
    } finally {
      setResolvingIndex(null);
    }
  };

  const hasQuery = query.trim().length > 0;
  const groups = groupByChapter(results);
  const current = activeIndex >= 0 && activeIndex < results.length ? activeIndex + 1 : null;

  return (
    <FolioPanel open={open} onClose={onClose} title="Search in Book" width={400} modal={false}>
      <div className="folio-inbook-search-panel">
        {/* Search input header */}
        <div className="folio-inbook-search-panel__field">
          <FolioIcons.Search size="sm" />
          <input
            type="search"
            className="folio-inbook-search-panel__input"
            placeholder="Type words or phrases…"
            value={query}
            onChange={(e) => {
              setErrorMessage(null);
              onQueryChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) onPrev();
                else onNext();
              } else if (e.key === "F3") {
                e.preventDefault();
                if (e.shiftKey) onPrev();
                else onNext();
              }
            }}
            autoFocus
            data-autofocus
            aria-label="Search text in book"
          />
          {hasQuery && (
            <button
              type="button"
              className="folio-inbook-search-panel__clear"
              aria-label="Clear search query"
              onClick={onClear}
            >
              <FolioIcons.Close size="sm" />
            </button>
          )}
        </div>

        {/* Status / Count bar */}
        <div className="folio-inbook-search-panel__status" aria-live="polite">
          {isSearching ? (
            <div className="folio-inbook-search-panel__loading">
              <span
                className="folio-reader-spinner"
                style={{ width: 14, height: 14, borderWidth: 2 }}
              />
              <span>Searching in book…</span>
            </div>
          ) : hasQuery && results.length > 0 ? (
            <div className="folio-inbook-search-panel__count">
              <span>
                {current
                  ? `${current} of ${results.length} matches`
                  : results.length === 1
                    ? "1 match found"
                    : `${results.length} matches found`}
              </span>
              <button
                type="button"
                className="folio-inbook-search-panel__step"
                aria-label="Previous match (Shift+F3)"
                disabled={current === null}
                onClick={onPrev}
              >
                <FolioIcons.ChevronUp size="sm" />
              </button>
              <button
                type="button"
                className="folio-inbook-search-panel__step"
                aria-label="Next match (F3)"
                disabled={current === null}
                onClick={onNext}
              >
                <FolioIcons.ChevronDown size="sm" />
              </button>
            </div>
          ) : hasQuery ? (
            <span className="folio-inbook-search-panel__count">No matches</span>
          ) : (
            <span className="folio-inbook-search-panel__hint">
              Enter at least 2 characters to search across all chapters.
            </span>
          )}
        </div>

        {/* Error message */}
        {(searchError || errorMessage) && (
          <div className="folio-workspace__notice folio-workspace__notice--error" role="alert">
            <span>{errorMessage || searchError}</span>
            <button
              type="button"
              className="folio-workspace__notice-close"
              aria-label="Dismiss error"
              onClick={() => setErrorMessage(null)}
            >
              <FolioIcons.Close size="sm" />
            </button>
          </div>
        )}

        {/* Results list, grouped by chapter with per-chapter counts */}
        {hasQuery && !isSearching && results.length === 0 ? (
          <div className="folio-workspace__empty">
            <FolioIcons.Search size="md" />
            <p className="folio-workspace__empty-title">No matches found</p>
            <p className="folio-workspace__empty-desc">
              Try searching for different keywords or check for spelling errors.
            </p>
          </div>
        ) : (
          <ul className="folio-inbook-search-panel__results">
            {groups.map((group) => (
              <li
                key={`${group.locator}-${group.first}`}
                className="folio-inbook-search-panel__item"
              >
                <div className="folio-inbook-search-panel__chapter">
                  <FolioIcons.Toc size="sm" />
                  <span>{group.title}</span>
                  {group.hits.length > 1 && (
                    <span className="folio-inbook-search-panel__chapter-count">
                      {group.hits.length}
                    </span>
                  )}
                </div>
                {group.hits.map(({ hit, index }) => {
                  const isResolving = resolvingIndex === index;
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={index}
                      type="button"
                      className={`folio-inbook-search-panel__card${isResolving ? " is-resolving" : ""}${isActive ? " is-active" : ""}`}
                      disabled={resolvingIndex !== null}
                      onClick={() => void handleSelect(hit, index)}
                    >
                      {/* L9: structured snippet — real React nodes, no raw HTML. */}
                      <div className="folio-inbook-search-panel__snippet">
                        {hit.snippet.head ? "…" : null}
                        {hit.snippet.parts.map((p, i) =>
                          p.mark ? (
                            <mark key={i}>{p.text}</mark>
                          ) : (
                            <span key={i}>{p.text}</span>
                          ),
                        )}
                        {hit.snippet.tail ? "…" : null}
                      </div>
                      {isResolving && (
                        <div className="folio-inbook-search-panel__resolving">
                          <span>Navigating…</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </FolioPanel>
  );
}
