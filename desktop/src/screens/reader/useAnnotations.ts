// Annotation data layer (04 §6): load/paint/refresh this book's annotations,
// create highlights and notes, toggle highlights, and toggle the bookmark at
// the current locator. Dialog/selection UI state stays with the screen; this
// hook owns persistence and the decoration paint through the engine ref.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { getLibraryManager } from "../../store/libraryUi";
import { handleError } from "../../lib/errorLog";
import type { Annotation } from "../../model/types";
import { nowIso } from "../../model/ids";
import type { ReaderEngine, TextSelectionInfo } from "../../reader/ReaderEngine";
import { decorationsFor } from "./decorations";
import { sameLocation, withAnchor } from "../../reader/locatorCodec";

/** Outcome of a bookmark toggle, surfaced as a user-facing notice (07 §2). */
export type BookmarkResult = "added" | "removed" | "failed";

interface UseAnnotationsOptions {
  docId: string | undefined;
  engineRef: RefObject<ReaderEngine | null>;
  resolveChapterId: (location: string | null | undefined) => string | null;
  showNavNotice: (message: string) => void;
  /** Selection dismissal on highlight/bookmark flows. */
  clearSelection: () => void;
}

export function useAnnotations({
  docId,
  engineRef,
  resolveChapterId,
  showNavNotice,
  clearSelection,
}: UseAnnotationsOptions) {
  /** This book's annotations — the source for bookmark state and the workspace panel. */
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const bookmarkToggleRef = useRef<() => Promise<BookmarkResult>>(async () => "failed");

  const paintAnnotations = useCallback(
    async (list: Annotation[]) => {
      setAnnotations(list);
      try {
        await engineRef.current?.applyDecorations(decorationsFor(list));
      } catch {
        /* a paint failure must not break reading */
      }
    },
    [engineRef],
  );

  const refreshAnnotations = useCallback(
    async (id?: string): Promise<Annotation[]> => {
      const target = id ?? docId;
      if (!target) return [];
      const list = await getLibraryManager().annotations.listForDoc(target);
      await paintAnnotations(list);
      return list;
    },
    [docId, paintAnnotations],
  );

  const createAnnotation = useCallback(
    async (
      sel: TextSelectionInfo,
      kind: Annotation["kind"],
      color: Annotation["color"] = null,
      note: string | null = null,
    ): Promise<boolean> => {
      if (!docId) return false;
      const lm = getLibraryManager();
      const prefix = sel.prefix.slice(0, 32);
      const suffix = sel.suffix.slice(0, 32);
      const annotation: Annotation = {
        id: crypto.randomUUID(),
        docId,
        chapterId: resolveChapterId(sel.location),
        quote: sel.quote,
        prefix,
        suffix,
        location: sel.location
          ? withAnchor(sel.location, { quote: sel.quote, prefix, suffix })
          : null,
        kind,
        color,
        note,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      try {
        await lm.annotations.add(annotation);
      } catch (e) {
        handleError(e, {
          context: "reader.annotations.add",
          userMessage:
            kind === "note" ? "The note could not be saved." : "The highlight could not be saved.",
        });
        return false;
      }
      try {
        await refreshAnnotations(docId);
      } catch (e) {
        handleError(e, { context: "reader.annotations.refresh" });
      }
      return true;
    },
    [docId, resolveChapterId, refreshAnnotations],
  );

  const toggleHighlight = useCallback(
    async (color: string, sel: TextSelectionInfo) => {
      if (!docId) return;
      const lm = getLibraryManager();
      try {
        const existing = (await lm.annotations.listForDoc(docId)).find(
          (a) => a.kind === "highlight" && a.quote === sel.quote && a.color === color,
        );
        if (existing) {
          await lm.annotations.remove(existing.id);
          showNavNotice("Highlight removed.");
        } else {
          const added = await createAnnotation(
            sel,
            "highlight",
            color as Annotation["color"],
            null,
          );
          if (!added) {
            clearSelection();
            return;
          }
          showNavNotice("Highlight added.");
          clearSelection();
          return;
        }
      } catch (e) {
        handleError(e, {
          context: "reader.annotations.highlight",
          userMessage: "The highlight could not be updated.",
        });
        clearSelection();
        return;
      }
      try {
        await refreshAnnotations(docId);
      } catch (e) {
        handleError(e, { context: "reader.annotations.refresh" });
      }
      clearSelection();
    },
    [docId, createAnnotation, refreshAnnotations, showNavNotice, clearSelection],
  );

  const handleBookmarkToggle = useCallback(async (): Promise<BookmarkResult> => {
    const engine = engineRef.current;
    if (!docId || !engine) return "failed";
    const loc = engine.currentLocator();
    if (!loc) return "failed";
    const refreshBookmarks = async () => {
      try {
        await refreshAnnotations(docId);
      } catch (e) {
        handleError(e, { context: "reader.annotations.refresh" });
      }
    };
    try {
      const lm = getLibraryManager();
      const existing = (await lm.annotations.listForDoc(docId)).find(
        (a) => a.kind === "bookmark" && sameLocation(a.location, loc.location),
      );
      if (existing) {
        await lm.annotations.remove(existing.id);
        await refreshBookmarks();
        return "removed";
      }
      const annotation: Annotation = {
        id: crypto.randomUUID(),
        docId,
        chapterId: resolveChapterId(loc.location),
        quote: "",
        prefix: "",
        suffix: "",
        location: loc.location || null,
        kind: "bookmark",
        color: null,
        note: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await lm.annotations.add(annotation);
      await refreshBookmarks();
      return "added";
    } catch (e) {
      handleError(e, { context: "reader.annotations.bookmark" });
      return "failed";
    }
  }, [docId, engineRef, resolveChapterId, refreshAnnotations]);

  // The keyboard matrix and chrome buttons call this through a ref so the
  // long-lived engine handlers never act on a stale callback (07 §3).
  useEffect(() => {
    bookmarkToggleRef.current = handleBookmarkToggle;
  }, [handleBookmarkToggle]);

  /** Reset on doc (re)load; decorations are re-painted by the engine effect. */
  const clearAnnotations = useCallback(() => setAnnotations([]), []);

  return {
    annotations,
    setAnnotations,
    clearAnnotations,
    refreshAnnotations,
    createAnnotation,
    toggleHighlight,
    handleBookmarkToggle,
    bookmarkToggleRef,
  };
}
