import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { FolioPanel } from "./FolioPanel";
import { FolioIcons } from "./FolioIcons";
import type { TocEntry } from "../reader/ReaderEngine";
import type { Annotation, Chapter } from "../model/types";
import { hrefOf } from "../reader/locatorCodec";
import { handleError } from "../lib/errorLog";

export type WorkspaceTab = "contents" | "bookmarks" | "notes";

export interface TocPanelProps {
  open: boolean;
  entries: TocEntry[];
  /** current chapter href (fragment-insensitive) */
  currentHref?: string | null;
  onClose: () => void;
  onSelect: (href: string) => Promise<unknown> | void;
  initialTab?: WorkspaceTab;
  annotations?: Annotation[];
  chapters?: Chapter[];
  onSelectAnnotation?: (target: {
    location: string | null;
    anchor?: { quote: string; prefix: string; suffix: string } | null;
  }) => Promise<unknown> | void;
  onRemoveBookmark?: (id: string) => Promise<unknown> | void;
  onDeleteAnnotation?: (id: string) => Promise<unknown> | void;
  onEditNote?: (annotation: Annotation) => void;
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

/**
 * Tolerant chapter-href comparison: entries, the locator and the stored
 * meta can carry different encodings/leading directories for one chapter.
 * Mirrors the comparison ReaderScreen applies to saved locations.
 */
export function tocHrefMatches(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const x = decoded(withoutFragment(a));
  const y = decoded(withoutFragment(b));
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "var(--folio-swatch-yellow, #FFF3B0)",
  green: "var(--folio-swatch-green, #CDE8C2)",
  blue: "var(--folio-swatch-blue, #BFDFF7)",
  pink: "var(--folio-swatch-pink, #F8CFE0)",
};

/**
 * Reading Workspace Panel (TOC, Bookmarks, Notes & Highlights).
 * Supports search, hierarchical tree, keyboard navigation, and
 * asynchronous navigation resolution before closing.
 */
export function TocPanel({
  open,
  entries,
  currentHref,
  onClose,
  onSelect,
  initialTab = "contents",
  annotations = [],
  chapters = [],
  onSelectAnnotation,
  onRemoveBookmark,
  onDeleteAnnotation,
  onEditNote,
}: TocPanelProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedIndices, setCollapsedIndices] = useState<Set<number>>(new Set());
  const [resolvingTarget, setResolvingTarget] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setSearchQuery("");
      setErrorMessage(null);
      setResolvingTarget(null);
    }
  }, [open, initialTab]);

  // Auto-scroll active chapter into view when opening the panel
  useEffect(() => {
    if (open && activeTab === "contents" && activeItemRef.current) {
      if (typeof activeItemRef.current.scrollIntoView === "function") {
        activeItemRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [open, activeTab, currentHref]);

  // Determine parent items that have children
  const parentIndices = useMemo(() => {
    const parents = new Set<number>();
    for (let i = 0; i < entries.length; i++) {
      if (i + 1 < entries.length && entries[i + 1].depth > entries[i].depth) {
        parents.add(i);
      }
    }
    return parents;
  }, [entries]);

  const toggleCollapse = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Filter TOC entries based on search query and collapse state
  const visibleEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      return entries
        .map((entry, index) => ({ entry, originalIndex: index }))
        .filter(({ entry }) => entry.title.toLowerCase().includes(q));
    }

    const result: { entry: TocEntry; originalIndex: number }[] = [];
    let hiddenDepth: number | null = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (hiddenDepth !== null) {
        if (entry.depth > hiddenDepth) {
          continue;
        } else {
          hiddenDepth = null;
        }
      }

      result.push({ entry, originalIndex: i });

      if (collapsedIndices.has(i)) {
        hiddenDepth = entry.depth;
      }
    }

    return result;
  }, [entries, searchQuery, collapsedIndices]);

  const hasExactMatch = useMemo(
    () => Boolean(currentHref && entries.some((e) => e.href === currentHref)),
    [entries, currentHref],
  );

  const handleSelectChapter = async (href: string) => {
    if (resolvingTarget) return;
    setResolvingTarget(href);
    setErrorMessage(null);
    try {
      const result = await onSelect(href);
      if (
        result &&
        typeof result === "object" &&
        "ok" in result &&
        !(result as { ok: boolean }).ok &&
        !("superseded" in result && (result as { superseded: boolean }).superseded)
      ) {
        setErrorMessage("Couldn't reach that section.");
      } else {
        onClose();
      }
    } catch (e) {
      handleError(e, { context: "reader.toc.navigate" });
      setErrorMessage("Couldn't reach that section.");
    } finally {
      setResolvingTarget(null);
    }
  };

  const handleSelectAnnotationItem = async (target: {
    location: string | null;
    anchor?: { quote: string; prefix: string; suffix: string } | null;
  }) => {
    if (resolvingTarget || !onSelectAnnotation) return;
    const key = target.location ?? "loc";
    setResolvingTarget(key);
    setErrorMessage(null);
    try {
      const result = await onSelectAnnotation(target);
      if (
        result &&
        typeof result === "object" &&
        "ok" in result &&
        !(result as { ok: boolean }).ok &&
        !("superseded" in result && (result as { superseded: boolean }).superseded)
      ) {
        setErrorMessage("Couldn't reach that reading location.");
      } else {
        onClose();
      }
    } catch (e) {
      handleError(e, { context: "reader.toc.annotation" });
      setErrorMessage("Couldn't reach that reading location.");
    } finally {
      setResolvingTarget(null);
    }
  };

  const bookmarks = useMemo(() => annotations.filter((a) => a.kind === "bookmark"), [annotations]);

  const notesAndHighlights = useMemo(
    () => annotations.filter((a) => a.kind === "highlight" || a.kind === "note"),
    [annotations],
  );

  const resolveChapterTitle = (location: string | null | undefined, chapterId?: string | null) => {
    if (chapterId) {
      const found = chapters.find((c) => c.id === chapterId);
      if (found) return found.title;
    }
    if (location) {
      const h = hrefOf(location);
      if (h) {
        const found = chapters.find((c) => tocHrefMatches(c.href, h));
        if (found) return found.title;
      }
    }
    return "Saved position";
  };

  return (
    <FolioPanel open={open} onClose={onClose} title="Reading Workspace" width={400}>
      <div className="folio-workspace">
        {/* Workspace Tab Bar */}
        <div
          className="folio-workspace-tabs"
          role="tablist"
          aria-label="Reading workspace sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "contents"}
            aria-controls="workspace-panel-contents"
            id="workspace-tab-contents"
            className={`folio-workspace-tab${activeTab === "contents" ? " is-active" : ""}`}
            onClick={() => {
              setActiveTab("contents");
              setErrorMessage(null);
            }}
          >
            <FolioIcons.Toc size="sm" />
            <span>Contents</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "bookmarks"}
            aria-controls="workspace-panel-bookmarks"
            id="workspace-tab-bookmarks"
            className={`folio-workspace-tab${activeTab === "bookmarks" ? " is-active" : ""}`}
            onClick={() => {
              setActiveTab("bookmarks");
              setErrorMessage(null);
            }}
          >
            <FolioIcons.Bookmark size="sm" />
            <span>Bookmarks</span>
            {bookmarks.length > 0 && (
              <span className="folio-workspace-tab__badge">{bookmarks.length}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "notes"}
            aria-controls="workspace-panel-notes"
            id="workspace-tab-notes"
            className={`folio-workspace-tab${activeTab === "notes" ? " is-active" : ""}`}
            onClick={() => {
              setActiveTab("notes");
              setErrorMessage(null);
            }}
          >
            <FolioIcons.Notes size="sm" />
            <span>Notes</span>
            {notesAndHighlights.length > 0 && (
              <span className="folio-workspace-tab__badge">{notesAndHighlights.length}</span>
            )}
          </button>
        </div>

        {/* Inline Error Notice */}
        {errorMessage && (
          <div className="folio-workspace__notice folio-workspace__notice--error" role="alert">
            <span>{errorMessage}</span>
            <button
              type="button"
              className="folio-workspace__notice-close"
              aria-label="Dismiss message"
              onClick={() => setErrorMessage(null)}
            >
              <FolioIcons.Close size="sm" />
            </button>
          </div>
        )}

        {/* Tab 1: Contents */}
        {activeTab === "contents" && (
          <div
            id="workspace-panel-contents"
            role="tabpanel"
            aria-labelledby="workspace-tab-contents"
            className="folio-workspace__section"
          >
            {entries.length > 0 && (
              <div className="folio-workspace__search-bar">
                <FolioIcons.Search size="sm" />
                <input
                  type="search"
                  className="folio-workspace__search-input"
                  placeholder="Search chapters…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Filter chapters"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="folio-workspace__search-clear"
                    aria-label="Clear filter"
                    onClick={() => setSearchQuery("")}
                  >
                    <FolioIcons.Close size="sm" />
                  </button>
                )}
              </div>
            )}

            {entries.length === 0 ? (
              <div className="folio-workspace__empty">
                <FolioIcons.Toc size="md" />
                <p>This book has no table of contents.</p>
              </div>
            ) : visibleEntries.length === 0 ? (
              <div className="folio-workspace__empty">
                <FolioIcons.Search size="md" />
                <p>No chapters matching &ldquo;{searchQuery}&rdquo;</p>
              </div>
            ) : (
              <nav aria-label="Table of contents" className="folio-toc-nav">
                <ul className="folio-toc">
                  {visibleEntries.map(({ entry, originalIndex }) => {
                    const active = hasExactMatch
                      ? entry.href === currentHref
                      : tocHrefMatches(entry.href, currentHref);
                    const isParent = parentIndices.has(originalIndex);
                    const isCollapsed = collapsedIndices.has(originalIndex);
                    const isResolving = resolvingTarget === entry.href;

                    return (
                      <li key={`${entry.href}-${originalIndex}`} className="folio-toc__row">
                        <div
                          className="folio-toc__row-content"
                          style={{
                            paddingLeft: `calc(var(--folio-space-2) + ${entry.depth} * 16px)`,
                          }}
                        >
                          {isParent ? (
                            <button
                              type="button"
                              className={`folio-toc__expander${isCollapsed ? " is-collapsed" : ""}`}
                              aria-label={
                                isCollapsed ? `Expand ${entry.title}` : `Collapse ${entry.title}`
                              }
                              onClick={(e) => toggleCollapse(originalIndex, e)}
                            >
                              <FolioIcons.ChevronDown size="sm" />
                            </button>
                          ) : (
                            <span className="folio-toc__expander-spacer" aria-hidden="true" />
                          )}
                          <button
                            ref={active ? activeItemRef : null}
                            type="button"
                            className={`folio-toc__item${active ? " is-current" : ""}${isResolving ? " is-resolving" : ""}`}
                            aria-current={active ? "location" : undefined}
                            disabled={resolvingTarget !== null}
                            onClick={() => void handleSelectChapter(entry.href)}
                          >
                            <span className="folio-toc__item-title">{entry.title}</span>
                            {isResolving && (
                              <span className="folio-toc__item-status" aria-hidden="true">
                                <span
                                  className="folio-reader-spinner"
                                  style={{ width: 14, height: 14, borderWidth: 2 }}
                                />
                              </span>
                            )}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            )}
          </div>
        )}

        {/* Tab 2: Bookmarks */}
        {activeTab === "bookmarks" && (
          <div
            id="workspace-panel-bookmarks"
            role="tabpanel"
            aria-labelledby="workspace-tab-bookmarks"
            className="folio-workspace__section"
          >
            {bookmarks.length === 0 ? (
              <div className="folio-workspace__empty">
                <FolioIcons.Bookmark size="md" />
                <p className="folio-workspace__empty-title">No bookmarks yet</p>
                <p className="folio-workspace__empty-desc">
                  Press <kbd>Ctrl+B</kbd> or click the bookmark button in the top toolbar to save
                  your reading position.
                </p>
              </div>
            ) : (
              <ul className="folio-workspace-list">
                {bookmarks.map((bm) => {
                  const chapterTitle = resolveChapterTitle(bm.location, bm.chapterId);
                  const isResolving = resolvingTarget === bm.location;
                  return (
                    <li key={bm.id} className="folio-workspace-card">
                      <button
                        type="button"
                        className={`folio-workspace-card__main${isResolving ? " is-resolving" : ""}`}
                        disabled={resolvingTarget !== null}
                        onClick={() =>
                          void handleSelectAnnotationItem({
                            location: bm.location ?? null,
                            anchor: null,
                          })
                        }
                      >
                        <div className="folio-workspace-card__header">
                          <span className="folio-workspace-card__icon">
                            <FolioIcons.Bookmark size="sm" />
                          </span>
                          <span className="folio-workspace-card__title">{chapterTitle}</span>
                        </div>
                        <div className="folio-workspace-card__meta">{formatDate(bm.createdAt)}</div>
                      </button>
                      {onRemoveBookmark && (
                        <button
                          type="button"
                          className="folio-workspace-card__action"
                          aria-label={`Remove bookmark in ${chapterTitle}`}
                          title="Remove bookmark"
                          onClick={() => void onRemoveBookmark(bm.id)}
                        >
                          <FolioIcons.Trash size="sm" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Tab 3: Notes & Highlights */}
        {activeTab === "notes" && (
          <div
            id="workspace-panel-notes"
            role="tabpanel"
            aria-labelledby="workspace-tab-notes"
            className="folio-workspace__section"
          >
            {notesAndHighlights.length === 0 ? (
              <div className="folio-workspace__empty">
                <FolioIcons.Notes size="md" />
                <p className="folio-workspace__empty-title">No notes or highlights yet</p>
                <p className="folio-workspace__empty-desc">
                  Select text in the book to highlight memorable passages or attach personal notes.
                </p>
              </div>
            ) : (
              <ul className="folio-workspace-list">
                {notesAndHighlights.map((item) => {
                  const chapterTitle = resolveChapterTitle(item.location, item.chapterId);
                  const isResolving = resolvingTarget === (item.location ?? "loc");
                  const colorCss =
                    HIGHLIGHT_COLORS[item.color ?? "yellow"] ?? HIGHLIGHT_COLORS.yellow;
                  const isNote = item.kind === "note" || Boolean(item.note);

                  return (
                    <li
                      key={item.id}
                      className="folio-workspace-card folio-workspace-card--annotation"
                    >
                      <button
                        type="button"
                        className={`folio-workspace-card__main${isResolving ? " is-resolving" : ""}`}
                        disabled={resolvingTarget !== null}
                        onClick={() =>
                          void handleSelectAnnotationItem({
                            location: item.location ?? null,
                            anchor: item.quote
                              ? {
                                  quote: item.quote,
                                  prefix: item.prefix ?? "",
                                  suffix: item.suffix ?? "",
                                }
                              : null,
                          })
                        }
                      >
                        <div className="folio-workspace-card__header">
                          <span
                            className="folio-workspace-card__dot"
                            style={{ backgroundColor: colorCss }}
                            aria-hidden="true"
                          />
                          <span className="folio-workspace-card__tag">
                            {isNote ? "Note" : "Highlight"}
                          </span>
                          <span className="folio-workspace-card__title">{chapterTitle}</span>
                        </div>

                        {item.quote && (
                          <blockquote className="folio-workspace-card__quote">
                            &ldquo;{item.quote}&rdquo;
                          </blockquote>
                        )}

                        {item.note && (
                          <div className="folio-workspace-card__note-text">{item.note}</div>
                        )}

                        <div className="folio-workspace-card__meta">
                          {formatDate(item.createdAt)}
                        </div>
                      </button>

                      <div className="folio-workspace-card__actions">
                        {isNote && onEditNote && (
                          <button
                            type="button"
                            className="folio-workspace-card__action"
                            aria-label="Edit note"
                            title="Edit note"
                            onClick={() => onEditNote(item)}
                          >
                            <FolioIcons.Pencil size="sm" />
                          </button>
                        )}
                        {onDeleteAnnotation && (
                          <button
                            type="button"
                            className="folio-workspace-card__action"
                            aria-label="Delete annotation"
                            title="Delete"
                            onClick={() => void onDeleteAnnotation(item.id)}
                          >
                            <FolioIcons.Trash size="sm" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </FolioPanel>
  );
}
