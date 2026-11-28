/**
 * Identity of the library-wide search corpus. Rebuilding reads every text
 * index, so the Library screen only rebuilds when this signature changes
 * (import, delete, retitle, or any index rewrite) instead of on every search
 * open.
 *
 * Index files are device-local derived data written asynchronously by the PDF
 * job and by restore/reindex. They can change without any row changing, so a
 * generation counter — bumped by every index writer — is part of the
 * signature. Without it, an already-open search panel keeps a stale corpus
 * until a title changes or the app restarts.
 */
import { create } from "zustand";

interface SearchIndexState {
  generation: number;
  bump: () => void;
}

export const useSearchIndexGeneration = create<SearchIndexState>((set) => ({
  generation: 0,
  bump: () => set((s) => ({ generation: s.generation + 1 })),
}));

/** Call after every successful write to `index/text/<docId>.json`. */
export function bumpSearchIndexGeneration(): void {
  useSearchIndexGeneration.getState().bump();
}

export function searchSignature(rows: { id: string; title: string }[]): string {
  const generation = useSearchIndexGeneration.getState().generation;
  return `${generation}\u0000${rows.map((row) => `${row.id}\u0000${row.title}`).join("\u0001")}`;
}
