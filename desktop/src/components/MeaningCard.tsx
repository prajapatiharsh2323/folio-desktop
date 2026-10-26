import { FolioDialog } from "./FolioDialog";
import { normalizeHeadword } from "../dict/normalise";

interface MeaningCardProps {
  open: boolean;
  term: string;
  onClose: () => void;
}

/** Dictionary meaning card (04 §7, Phase 10). Rust dict_sqlite_query is a stub. */
export function MeaningCard({ open, term, onClose }: MeaningCardProps) {
  return (
    <FolioDialog open={open} onClose={onClose} title="Meaning">
      <p className="folio-helper">
        “{normalizeHeadword(term)}” — the dictionary pack arrives in Phase 10.
      </p>
    </FolioDialog>
  );
}
