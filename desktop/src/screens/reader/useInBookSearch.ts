// In-book text search state (07 §4, R2): owns the panel's open/query/results
// state, the debounced engine query, the active-occurrence cursor for
// Next/Prev, and the temporary "active match" decoration (its own engine
// group, so annotation highlights are never disturbed).
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ReaderEngine, SearchHit } from "../../reader/ReaderEngine";
import type { ReaderNavigationCoordinator } from "../../reader/navigation";
import { withAnchor } from "../../reader/locatorCodec";
import { handleError } from "../../lib/errorLog";

export type InBookSearchHit = SearchHit;

/** Distinct fill for the match the panel is currently on. */
const ACTIVE_COLOR = "#FFD27F";
const ACTIVE_ID = "folio-search-active";

interface UseInBookSearchOptions {
  engineRef: RefObject<ReaderEngine | null>;
  navRef: RefObject<ReaderNavigationCoordinator | null>;
}

/** Debounced in-book search lifecycle. */
export function useInBookSearch({ engineRef, navRef }: UseInBookSearchOptions) {
  const [inbookSearchOpen, setInbookSearchOpen] = useState(false);
  const [inbookQuery, setInbookQuery] = useState("");
  const [inbookSearching, setInbookSearching] = useState(false);
  const [inbookError, setInbookError] = useState<string | null>(null);
  const [inbookResults, setInbookResults] = useState<InBookSearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inbookTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inbookSearchSeqRef = useRef(0);
  const resultsRef = useRef<InBookSearchHit[]>([]);
  resultsRef.current = inbookResults;
  /** Mirror of activeIndex so move()/select() stay pure w.r.t. React state. */
  const activeIndexRef = useRef(-1);

  /** Paint the active match; a skipped locator means no wrong-place highlight. */
  const paintActive = useCallback(
    async (hit: InBookSearchHit | null) => {
      const engine = engineRef.current;
      if (!engine) return;
      try {
        if (hit?.anchor?.quote) {
          await engine.applyDecorations(
            [
              {
                id: ACTIVE_ID,
                locator: withAnchor(hit.locator, hit.anchor),
                style: "highlight",
                color: ACTIVE_COLOR,
                group: "search",
              },
            ],
            "search",
          );
        } else {
          await engine.applyDecorations([], "search");
        }
      } catch (error) {
        // Decoration painting must never break search navigation.
        handleError(error, { context: "reader.search.decoration" });
      }
    },
    [engineRef],
  );

  // Debounced in-book text search. Two characters minimum (R2).
  useEffect(() => {
    if (!inbookSearchOpen) return;
    if (inbookTimerRef.current) clearTimeout(inbookTimerRef.current);
    if (inbookQuery.trim().length < 2) {
      setInbookResults([]);
      setInbookSearching(false);
      setInbookError(null);
      activeIndexRef.current = -1;
      setActiveIndex(-1);
      void paintActive(null);
      return;
    }
    setInbookSearching(true);
    setInbookError(null);
    const token = ++inbookSearchSeqRef.current;
    inbookTimerRef.current = setTimeout(async () => {
      const engine = engineRef.current;
      if (!engine || inbookQuery.trim().length < 2) {
        setInbookResults([]);
        setInbookSearching(false);
        return;
      }
      try {
        const hits = await engine.search(inbookQuery);
        if (token === inbookSearchSeqRef.current) {
          setInbookResults(hits);
          activeIndexRef.current = -1;
          setActiveIndex(-1);
          setInbookSearching(false);
          void paintActive(null);
        }
      } catch {
        if (token === inbookSearchSeqRef.current) {
          setInbookResults([]);
          activeIndexRef.current = -1;
          setActiveIndex(-1);
          setInbookSearching(false);
          setInbookError("Search failed to complete.");
        }
      }
    }, 250);
    return () => {
      if (inbookTimerRef.current) clearTimeout(inbookTimerRef.current);
    };
  }, [inbookQuery, inbookSearchOpen, engineRef, paintActive]);

  /** Close paths (toggle, Escape, close button, doc reset) clear the active
   *  decoration; a single effect keeps that true regardless of caller. */
  useEffect(() => {
    if (!inbookSearchOpen) void paintActive(null);
  }, [inbookSearchOpen, paintActive]);

  /** Ctrl+F: open (or close) the panel; opening focuses the field. */
  const toggle = useCallback(() => {
    setInbookSearchOpen((open) => !open);
  }, []);

  /** Escape / close button: close the panel (decoration cleared by the effect). */
  const close = useCallback(() => {
    setInbookSearchOpen(false);
  }, []);

  /** Clear the field and results but keep the panel open (panel Clear button). */
  const clear = useCallback(() => {
    setInbookQuery("");
    setInbookResults([]);
    setInbookSearching(false);
    setInbookError(null);
    activeIndexRef.current = -1;
    setActiveIndex(-1);
  }, []);

  /** Clear results and reset the query (used when the doc changes). */
  const reset = useCallback(() => {
    setInbookSearchOpen(false);
    setInbookQuery("");
    setInbookResults([]);
    setInbookSearching(false);
    setInbookError(null);
    activeIndexRef.current = -1;
    setActiveIndex(-1);
    void paintActive(null);
  }, [paintActive]);

  /**
   * Navigate to a hit (result click or Next/Prev): lands on the chapter, then
   * anchors to the match. The panel stays open; the active decoration follows.
   */
  const select = useCallback(
    async (index: number): Promise<boolean> => {
      const hit = resultsRef.current[index];
      const nav = navRef.current;
      const engine = engineRef.current;
      if (!hit || !nav || !engine) return false;
      const outcome = await nav.goToSearchHit(
        { locator: hit.locator, anchor: hit.anchor ?? null },
        "search",
      );
      if (outcome.ok && !outcome.superseded) {
        activeIndexRef.current = index;
        setActiveIndex(index);
        await paintActive(hit);
      }
      return outcome.ok && !outcome.superseded;
    },
    [navRef, engineRef, paintActive],
  );

  /** Next/Prev match with wrap-around; returns whether a jump was started. */
  const move = useCallback(
    (delta: 1 | -1) => {
      const results = resultsRef.current;
      if (results.length === 0) return false;
      const base =
        activeIndexRef.current === -1
          ? delta === 1
            ? 0
            : results.length - 1
          : activeIndexRef.current;
      const next = (base + delta + results.length) % results.length;
      activeIndexRef.current = next;
      setActiveIndex(next);
      void select(next);
      return true;
    },
    [select],
  );

  const moveNext = useCallback(() => void move(1), [move]);
  const movePrev = useCallback(() => void move(-1), [move]);

  return {
    open: inbookSearchOpen,
    query: inbookQuery,
    searching: inbookSearching,
    error: inbookError,
    results: inbookResults,
    activeIndex,
    setOpen: setInbookSearchOpen as Dispatch<SetStateAction<boolean>>,
    setQuery: setInbookQuery as Dispatch<SetStateAction<string>>,
    toggle,
    clear,
    reset,
    close,
    select,
    move,
    /** Zero-arg stable step callbacks for the keyboard hook (F3/Shift+F3). */
    moveNext,
    movePrev,
  };
}
