import { useState } from "react";
import { FolioPanel } from "./FolioPanel";
import { FolioIcons } from "./FolioIcons";
import { handleError } from "../lib/errorLog";

interface SearchHit {
  chapterTitle: string;
  snippetHtml: string;
  locator: string;
}

interface InBookSearchPanelProps {
  open: boolean;
  query: string;
  results: SearchHit[];
  isSearching: boolean;
  searchError?: string | null;
  onQueryChange: (query: string) => void;
  onClear: () => void;
  onClose: () => void;
  onSelectResult: (locator: string) => Promise<unknown> | void;
}

/**
 * In-Book Search Panel:
 * Fast, debounced text search across EPUB chapters with highlighted snippets,
 * result counts, keyboard navigation, and coordinated jump execution.
 */
export function InBookSearchPanel({
  open,
  query,
  results,
  isSearching,
  searchError = null,
  onQueryChange,
  onClear,
  onClose,
  onSelectResult,
}: InBookSearchPanelProps) {
  const [resolvingLocator, setResolvingLocator] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSelect = async (locator: string) => {
    if (resolvingLocator) return;
    setResolvingLocator(locator);
    setErrorMessage(null);
    try {
      const outcome = await onSelectResult(locator);
      if (
        outcome &&
        typeof outcome === "object" &&
        "ok" in outcome &&
        !(outcome as { ok: boolean }).ok &&
        !("superseded" in outcome && (outcome as { superseded: boolean }).superseded)
      ) {
        setErrorMessage("Couldn't reach that search location.");
      } else {
        onClose();
      }
    } catch (e) {
      handleError(e, { context: "reader.search.navigate" });
      setErrorMessage("Couldn't reach that search location.");
    } finally {
      setResolvingLocator(null);
    }
  };

  const hasQuery = query.trim().length > 0;

  return (
    <FolioPanel open={open} onClose={onClose} title="Search in Book" width={400}>
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
          ) : hasQuery ? (
            <span className="folio-inbook-search-panel__count">
              {results.length === 1 ? "1 match found" : `${results.length} matches found`}
            </span>
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

        {/* Results list */}
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
            {results.map((hit, index) => {
              const isResolving = resolvingLocator === hit.locator;
              return (
                <li key={`${hit.locator}-${index}`} className="folio-inbook-search-panel__item">
                  <button
                    type="button"
                    className={`folio-inbook-search-panel__card${isResolving ? " is-resolving" : ""}`}
                    disabled={resolvingLocator !== null}
                    onClick={() => void handleSelect(hit.locator)}
                  >
                    <div className="folio-inbook-search-panel__chapter">
                      <FolioIcons.Toc size="sm" />
                      <span>{hit.chapterTitle}</span>
                    </div>
                    <div
                      className="folio-inbook-search-panel__snippet"
                      dangerouslySetInnerHTML={{ __html: hit.snippetHtml }}
                    />
                    {isResolving && (
                      <div className="folio-inbook-search-panel__resolving">
                        <span>Navigating…</span>
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </FolioPanel>
  );
}
