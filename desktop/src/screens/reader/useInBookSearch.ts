// In-book text search state (07 §4). Owns the panel's open/query/results
// state and the debounced engine query; the engine ref comes from the
// lifecycle hook so panel and engine stay decoupled.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ReaderEngine } from "../../reader/ReaderEngine";

export interface InBookSearchHit {
  chapterTitle: string;
  snippetHtml: string;
  locator: string;
}

interface UseInBookSearchOptions {
  engineRef: RefObject<ReaderEngine | null>;
}

/** Debounced in-book search lifecycle. */
export function useInBookSearch({ engineRef }: UseInBookSearchOptions) {
  const [inbookSearchOpen, setInbookSearchOpen] = useState(false);
  const [inbookQuery, setInbookQuery] = useState("");
  const [inbookSearching, setInbookSearching] = useState(false);
  const [inbookError, setInbookError] = useState<string | null>(null);
  const [inbookResults, setInbookResults] = useState<InBookSearchHit[]>([]);
  const inbookTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inbookSearchSeqRef = useRef(0);

  // Debounced in-book text search
  useEffect(() => {
    if (!inbookSearchOpen) return;
    if (inbookTimerRef.current) clearTimeout(inbookTimerRef.current);
    if (!inbookQuery.trim()) {
      setInbookResults([]);
      setInbookSearching(false);
      setInbookError(null);
      return;
    }
    setInbookSearching(true);
    setInbookError(null);
    const token = ++inbookSearchSeqRef.current;
    inbookTimerRef.current = setTimeout(async () => {
      const engine = engineRef.current;
      if (!engine || !inbookQuery.trim()) {
        setInbookResults([]);
        setInbookSearching(false);
        return;
      }
      try {
        const hits = await engine.search(inbookQuery);
        if (token === inbookSearchSeqRef.current) {
          setInbookResults(hits);
          setInbookSearching(false);
        }
      } catch {
        if (token === inbookSearchSeqRef.current) {
          setInbookResults([]);
          setInbookSearching(false);
          setInbookError("Search failed to complete.");
        }
      }
    }, 250);
    return () => {
      if (inbookTimerRef.current) clearTimeout(inbookTimerRef.current);
    };
  }, [inbookQuery, inbookSearchOpen, engineRef]);

  /** Ctrl+F: open (or close) the panel; opening focuses the field. */
  const toggle = useCallback(() => {
    setInbookSearchOpen((open) => !open);
  }, []);

  /** Clear the field and results but keep the panel open (panel Clear button). */
  const clear = useCallback(() => {
    setInbookQuery("");
    setInbookResults([]);
    setInbookSearching(false);
    setInbookError(null);
  }, []);

  /** Clear results and reset the query (used when the doc changes). */
  const reset = useCallback(() => {
    setInbookSearchOpen(false);
    setInbookQuery("");
    setInbookResults([]);
    setInbookSearching(false);
    setInbookError(null);
  }, []);

  return {
    open: inbookSearchOpen,
    query: inbookQuery,
    searching: inbookSearching,
    error: inbookError,
    results: inbookResults,
    setOpen: setInbookSearchOpen,
    setQuery: setInbookQuery,
    toggle,
    clear,
    reset,
  };
}
