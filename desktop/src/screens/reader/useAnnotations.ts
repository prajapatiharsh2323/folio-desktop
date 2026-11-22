// Annotation data layer (04 §6): load/paint/refresh this book's annotations,
// create highlights and notes, toggle highlights, and toggle the bookmark at
// the current locator. Dialog/selection UI state stays with the screen; this
// hook owns persistence and the decoration paint through the engine ref.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { getLibraryManager } from "../../store/libraryUi";
import { handleError } from "../../lib/errorLog";
import { pushToast } from "../../shell/toasts";
import type { Annotation } from "../../model/types";
import { nowIso } from "../../model/ids";
import type { ReaderEngine, TextSelectionInfo } from "../../reader/ReaderEngine";
import type { ResolvedTheme } from "../../reader/readerThemes";
import { decorationsFor } from "./decorations";
import { MAX_DECORATION_ANCHOR_CHARS, sameLocation, withAnchor } from "../../reader/locatorCodec";
import {
  findOverlappingHighlight,
  highlightAction,
  type HighlightAction,
} from "./annotationOverlap";

/** Outcome of a bookmark toggle, surfaced as a user-facing notice (07 §2). */
export type BookmarkResult = "added" | "removed" | "failed";

interface UseAnnotationsOptions {
  docId: string | undefined;
  engineRef: RefObject<ReaderEngine | null>;
  resolveChapterId: (location: string | null | undefined) => string | null;
  showNavNotice: (message: string) => void;
  /** Selection dismissal on highlight/bookmark flows. */
  clearSelection: () => void;
  /** Effective reader theme (R16): highlight tints resolve per theme, not per OS flag. */
  theme: ResolvedTheme;
}

export function useAnnotations({
  docId,
  engineRef,
  resolveChapterId,
  showNavNotice,
  clearSelection,
  theme,
}: UseAnnotationsOptions) {
  /** This book's annotations — the source for bookmark state and the workspace panel. */
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // Read through a ref so paint callbacks stay referentially stable: a theme
  // flip must not re-create them (and with them every dependent callback).
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const bookmarkToggleRef = useRef<() => Promise<BookmarkResult>>(async () => "failed");

  const paintAnnotations = useCallback(
    async (list: Annotation[]) => {
      setAnnotations(list);
      try {
        await engineRef.current?.applyDecorations(decorationsFor(list, themeRef.current));
      } catch (error) {
        // A paint failure must not break reading, but it must be diagnosable.
        handleError(error, { context: "reader.annotations.paint" });
      }
    },
    [engineRef],
  );

  // R16: an OS flip *or a manual theme change* repaints placed highlights in
  // the other palette (the engine's own setSystemDark only resubmits prefs).
  const lastThemeRef = useRef(theme);
  useEffect(() => {
    if (lastThemeRef.current.theme === theme.theme) return;
    lastThemeRef.current = theme;
    const engine = engineRef.current;
    if (!engine || annotations.length === 0) return;
    void engine.applyDecorations(decorationsFor(annotations, theme)).catch((error) => {
      handleError(error, { context: "reader.annotations.repaint" });
    });
  }, [theme, annotations, engineRef]);

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
          ? withAnchor(
              sel.location,
              { quote: sel.quote, prefix, suffix },
              MAX_DECORATION_ANCHOR_CHARS,
            )
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

  /**
   * Re-highlight a selection (R5). An overlapping existing highlight is
   * toggled off on the same colour and recoloured on a different one — a
   * selection can never create an overlapping duplicate.
   */
  const toggleHighlight = useCallback(
    async (color: string, sel: TextSelectionInfo) => {
      if (!docId) return;
      const lm = getLibraryManager();
      let action: HighlightAction = "create";
      let existing: Annotation | null = null;
      try {
        existing = findOverlappingHighlight(await lm.annotations.listForDoc(docId), sel.location, {
          quote: sel.quote,
          prefix: sel.prefix,
          suffix: sel.suffix,
        });
        action = highlightAction(existing, color);
      } catch (e) {
        handleError(e, { context: "reader.annotations.highlight" });
        // Fail towards creating: the old exact-match path was create too.
      }
      try {
        if (action === "toggle-off" && existing) {
          await lm.annotations.remove(existing.id);
          await refreshAnnotations(docId);
          showNavNotice("Highlight removed.");
          clearSelection();
          return;
        }
        if (action === "recolour" && existing) {
          await lm.annotations.update(existing.id, {
            color: color as Annotation["color"],
            updatedAt: nowIso(),
          });
          await refreshAnnotations(docId);
          showNavNotice("Highlight updated.");
          clearSelection();
          return;
        }
        const added = await createAnnotation(sel, "highlight", color as Annotation["color"], null);
        if (!added) {
          clearSelection();
          return;
        }
        showNavNotice("Highlight added.");
      } catch (e) {
        handleError(e, {
          context: "reader.annotations.highlight",
          userMessage: "The highlight could not be updated.",
        });
      }
      clearSelection();
    },
    [docId, createAnnotation, refreshAnnotations, showNavNotice, clearSelection],
  );

  /** Update an annotation in place (colour, note) and repaint (R5). */
  const updateAnnotation = useCallback(
    async (id: string, patch: Partial<Annotation>): Promise<boolean> => {
      const lm = getLibraryManager();
      try {
        await lm.annotations.update(id, { ...patch, updatedAt: nowIso() });
      } catch (e) {
        handleError(e, {
          context: "reader.annotations.update",
          userMessage: "The annotation could not be updated.",
        });
        return false;
      }
      if (!docId) return true;
      try {
        await refreshAnnotations(docId);
      } catch (e) {
        handleError(e, { context: "reader.annotations.refresh" });
      }
      return true;
    },
    [docId, refreshAnnotations],
  );

  /**
   * Delete an annotation and offer Undo (R5): the toast action re-adds the
   * exact record (same id and timestamps) so a notes-pane refresh on mobile
   * or a later session still reconciles cleanly.
   */
  const deleteAnnotation = useCallback(
    async (annotation: Annotation): Promise<boolean> => {
      const lm = getLibraryManager();
      try {
        await lm.annotations.remove(annotation.id);
      } catch (e) {
        handleError(e, {
          context: "reader.annotations.remove",
          userMessage: "The annotation could not be deleted.",
        });
        return false;
      }
      if (docId) {
        try {
          await refreshAnnotations(docId);
        } catch (e) {
          handleError(e, { context: "reader.annotations.refresh" });
        }
      }
      const noun = annotation.kind === "note" ? "Note" : "Highlight";
      pushToast({
        tone: "info",
        text: `${noun} deleted.`,
        action: {
          label: "Undo",
          run: () => {
            void (async () => {
              try {
                await lm.annotations.add(annotation);
              } catch (e) {
                handleError(e, {
                  context: "reader.annotations.undo",
                  userMessage: "The annotation could not be restored.",
                });
                return;
              }
              if (docId) {
                try {
                  await refreshAnnotations(docId);
                } catch (e) {
                  handleError(e, { context: "reader.annotations.refresh" });
                }
              }
              showNavNotice(`${noun} restored.`);
            })();
          },
        },
      });
      return true;
    },
    [docId, refreshAnnotations, showNavNotice],
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
    updateAnnotation,
    deleteAnnotation,
    handleBookmarkToggle,
    bookmarkToggleRef,
  };
}
