import { useEffect, useState } from "react";
import { FolioDialog } from "./FolioDialog";
import { READER_THEME_COLORS } from "../model/defaults";
import type { ReadingPrefs } from "../model/types";
import {
  DICT_ATTRIBUTION,
  lookupMeaning,
  type DictEntry,
  type LookupResult,
} from "../dict/lookup";

interface MeaningCardProps {
  open: boolean;
  term: string;
  onClose: () => void;
  /** Reading theme so the card matches the page behind it (06 §5). */
  theme?: ReadingPrefs["theme"];
}

/** Dictionary meaning card (04 §7, 06 §5, Phase 10). */
export function MeaningCard({ open, term, onClose, theme = "light" }: MeaningCardProps) {
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setResult(null);
    void lookupMeaning(term).then((r) => {
      if (cancelled) return;
      setResult(r);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, term]);

  const colors = READER_THEME_COLORS[theme] ?? READER_THEME_COLORS.light;
  const entries: DictEntry[] = result?.entries ?? [];

  return (
    <FolioDialog open={open} onClose={onClose} title="Meaning">
      <div
        className="folio-meaning"
        style={{ background: colors.bg, color: colors.text }}
      >
        {loading && <p className="folio-helper">Looking up “{term.trim()}”…</p>}
        {!loading && result?.status === "missing" && (
          <p className="folio-helper">
            {result.message ?? "The offline dictionary pack is not installed."}
          </p>
        )}
        {!loading && result?.status === "error" && (
          <p className="folio-helper">{result.message ?? "Lookup failed."}</p>
        )}
        {!loading && result?.status === "empty" && (
          <p className="folio-helper">No meaning found for “{term.trim()}”.</p>
        )}
        {!loading &&
          entries.map((entry) => (
            <section key={entry.headword} className="folio-meaning__entry">
              <h3 className="folio-meaning__headword">{entry.headword}</h3>
              {entry.senses.map((sense, i) => (
                <p key={i} className="folio-meaning__sense">
                  {sense.pos && <span className="folio-meaning__pos">{sense.pos}</span>}
                  <span>{sense.meaning}</span>
                  {sense.example && (
                    <span className="folio-meaning__example">{sense.example}</span>
                  )}
                </p>
              ))}
            </section>
          ))}
      </div>
      <p className="folio-meaning__attribution">{DICT_ATTRIBUTION}</p>
    </FolioDialog>
  );
}
