import { useEffect, useRef, useState, useCallback } from "react";
import { FolioButton } from "../components/FolioButton";
import { FolioChip } from "../components/FolioChip";
import { FolioIcons } from "../components/FolioIcons";
import { FolioEmptyState } from "../components/FolioEmptyState";
import { FolioBookRow } from "../components/FolioBookRow";
import { FolioDialog } from "../components/FolioDialog";
import { useLibraryUi, getLibraryFs, getLibraryManager } from "../store/libraryUi";
import { useRouteStore } from "../store/routeStore";
import { pickImportFiles, filesFromDataTransfer, filesFromTauriDrop } from "../lib/fileSource";
import { MiniSearch } from "../search/miniSearch";
import { libraryLayout as L } from "../lib/libraryPaths";
import { readStorage, writeStorage } from "../lib/storage";
import { visibleRowIds } from "../lib/libraryView";
import { searchSignature } from "../lib/searchCache";
import { hasBlockingOverlay } from "../shell/overlays";
import { pushToast } from "../shell/toasts";

/** Library screen (03 §5.2) wired to the schema-1 library via LibraryManager. */
export function LibraryScreen() {
  const rows = useLibraryUi((s) => s.rows);
  const loading = useLibraryUi((s) => s.loading);
  const loadError = useLibraryUi((s) => s.error);
  const recovery = useLibraryUi((s) => s.recovery);
  const recoveryDialogOpen = useLibraryUi((s) => s.recoveryDialogOpen);
  const setRecoveryDialogOpen = useLibraryUi((s) => s.setRecoveryDialogOpen);
  const duplicate = useLibraryUi((s) => s.duplicate);
  const resolveDuplicate = useLibraryUi((s) => s.resolveDuplicate);
  const cancelDuplicate = useLibraryUi((s) => s.cancelDuplicate);
  const refresh = useLibraryUi((s) => s.refresh);
  const importPicked = useLibraryUi((s) => s.importPicked);
  const removeDamaged = useLibraryUi((s) => s.removeDamaged);
  const removeInterrupted = useLibraryUi((s) => s.removeInterrupted);
  const openReader = useRouteStore((s) => s.openReader);
  const [dragOver, setDragOver] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterDocIds, setFilterDocIds] = useState<Set<string> | null>(null);
  const [sort, setSort] = useState<string>(
    () => readStorage("folio.library.sort") || "recent"
  );
  const [filterCollection, setFilterCollection] = useState<string | null>(null);
  const [collections, setCollections] = useState<{ id: string; name: string }[]>([]);
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    {
      id: string;
      title: string;
      chapterTitle?: string;
      snippet: string;
      docId?: string;
      location?: string;
    }[]
  >([]);
  const searchIndexRef = useRef<{ signature: string; index: MiniSearch } | null>(null);
  const [searchIndexVersion, setSearchIndexVersion] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildSearchIndex = useCallback(async () => {
    const signature = searchSignature(rows);
    const cached = searchIndexRef.current;
    if (cached && cached.signature === signature) return;

    const lm = getLibraryManager();
    const idx = new MiniSearch();
    for (const row of rows) {
      try {
        const raw = await getLibraryFs().readText(L.indexText(lm.root, row.id));
        const parsed = JSON.parse(raw) as {
          chapters: { id: string; title: string; text: string; href?: string }[];
        };
        // Indexes written before hrefs were stored still resolve their chapter
        // location through meta.json.
        let metaHrefs: Map<string, string> | null = null;
        if ((parsed.chapters ?? []).some((ch) => !ch.href)) {
          try {
            const meta = await lm.meta.read(row.slug);
            metaHrefs = new Map((meta?.chapters ?? []).map((c) => [c.id, c.href]));
          } catch {
            metaHrefs = null;
          }
        }
        for (const ch of parsed.chapters ?? []) {
          idx.add({
            id: `${row.id}::${ch.id}`,
            title: row.title,
            docTitle: row.title,
            text: ch.text ?? "",
            docId: row.id,
            href: ch.href ?? metaHrefs?.get(ch.id),
            chapterTitle: ch.title,
          });
        }
      } catch {
        /* no index yet */
      }
    }
    searchIndexRef.current = { signature, index: idx };
    // Results typed while the index was building must run against it.
    setSearchIndexVersion((v) => v + 1);
  }, [rows]);

  const runSearch = useCallback((q: string) => {
    const idx = searchIndexRef.current?.index;
    if (!idx || !q.trim()) {
      setSearchResults([]);
      return;
    }
    const hits = idx.search(q, 25);
    setSearchResults(
      hits.map((h) => ({
        id: h.id,
        title: h.docTitle ?? "Document",
        chapterTitle: h.chapterTitle,
        snippet: h.snippet,
        docId: h.docId,
        location: h.href,
      }))
    );
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    void buildSearchIndex();
  }, [searchOpen, buildSearchIndex]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => runSearch(searchQuery), 250);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, runSearch, searchIndexVersion]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // An import prompt cannot outlive the screen that renders it: resolve it as
  // "skip" so the serialised import queue is never left waiting.
  useEffect(() => () => cancelDuplicate(), [cancelDuplicate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hasBlockingOverlay()) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true']") ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "i" || e.key === "I")) {
        // Ctrl+I import (07 §1 global matrix) — same picker as the toolbar.
        e.preventDefault();
        void onImport();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        // Ctrl+F in-library opens the search panel (07 §1 global matrix).
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const lm = getLibraryManager();
        const list = await lm.collections.list();
        setCollections(list.map((c) => ({ id: c.id, name: c.name })));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Tauri drag-and-drop (webview-level); HTML5 dnd is the browser fallback.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "over") setDragOver(true);
          else if (event.payload.type === "leave") setDragOver(false);
          else if (event.payload.type === "drop") {
            setDragOver(false);
            // The tour, onboarding and dialogs own the window; a drop must
            // not import underneath them.
            if (hasBlockingOverlay()) return;
            void filesFromTauriDrop(event.payload.paths).then((f) => {
              if (f) void importPicked(f);
            });
          }
        });
        if (cancelled) un();
        else unlisten = un;
      } catch {
        /* not in Tauri — HTML5 handlers cover it */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [importPicked]);

  const onImport = async () => {
    const files = await pickImportFiles();
    await importPicked(files);
  };

  const visibleRows = rows
    .filter((r) => (filterDocIds ? filterDocIds.has(r.id) : true))
    .slice()
    .sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "author") {
        // Authors last, then title (06 §1.2): a book without an author must
        // not jump ahead of named authors just because "" sorts first.
        const aa = a.author?.trim() ?? "";
        const bb = b.author?.trim() ?? "";
        if (aa && !bb) return -1;
        if (!aa && bb) return 1;
        const byAuthor = aa.localeCompare(bb);
        if (byAuthor !== 0) return byAuthor;
        return a.title.localeCompare(b.title);
      }
      return 0;
    });

  // A filter or search change invalidates the old selection: acting on hidden
  // rows is how Ctrl+A used to delete books the user could not see.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterCollection, searchQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hasBlockingOverlay()) return;
      if (selectionMode && (e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setSelectedIds(visibleRowIds(rows, filterDocIds));
      } else if (selectionMode && e.key === "Escape") {
        e.preventDefault();
        setSelectionMode(false);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode, rows, filterDocIds]);

  const addToCollection = async (collectionId: string) => {
    const lm = getLibraryManager();
    await lm.mutateCollectionDocs(collectionId, { add: [...selectedIds] });
    setAddToCollectionOpen(false);
    setSelectedIds(new Set());
    setSelectionMode(false);
    await refresh();
  };

  useEffect(() => {
    if (!filterCollection) {
      setFilterDocIds(null);
      return;
    }
    (async () => {
      try {
        const lm = getLibraryManager();
        const list = await lm.collections.list();
        const c = list.find((x) => x.id === filterCollection);
        setFilterDocIds(new Set(c?.docIds ?? []));
      } catch {
        setFilterDocIds(null);
      }
    })();
  }, [filterCollection]);

  useEffect(() => {
    writeStorage("folio.library.sort", sort);
  }, [sort]);

  const count = visibleRows.length;

  return (
    <>
      <header className="folio-toolbar">
        <div className="folio-toolbar__titles">
          <div className="folio-toolbar__title">Library</div>
          <div className="folio-toolbar__subtitle">
            {count} document{count === 1 ? "" : "s"}
          </div>
        </div>
        <button
          type="button"
          className="folio-iconbtn"
          aria-label={searchOpen ? "Close search" : "Search library"}
          data-tour="library-search"
          onClick={() => setSearchOpen((v) => !v)}
        >
          <FolioIcons.Search />
        </button>
      </header>

      {searchOpen && (
        <div className="folio-searchbar">
          <input
            type="search"
            className="folio-searchbar__input"
            placeholder="Search your library…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setSearchOpen(false);
                setSearchQuery("");
              }
            }}
            autoFocus
          />
        </div>
      )}

      {searchOpen && searchResults.length > 0 && (
        <div className="folio-searchresults">
          {searchResults.map((r) => (
            <button
              key={r.id}
              type="button"
              className="folio-searchresult"
              onClick={() => {
                if (r.docId) {
                  openReader({ docId: r.docId, location: r.location ?? null });
                }
                setSearchOpen(false);
                setSearchQuery("");
              }}
            >
              <div className="folio-searchresult__title">{r.title}</div>
              {r.chapterTitle && r.chapterTitle !== r.title && (
                <div className="folio-searchresult__chapter">{r.chapterTitle}</div>
              )}
              <div
                className="folio-searchresult__snippet"
                dangerouslySetInnerHTML={{ __html: r.snippet }}
              />
            </button>
          ))}
        </div>
      )}

      {recovery && (recovery.damaged.length > 0 || recovery.interrupted.length > 0) && (
        <div className="folio-banner folio-banner--warning" role="status">
          <span>
            {recovery.damaged.length > 0 &&
              `${recovery.damaged.length} document${recovery.damaged.length === 1 ? " is" : "s are"} damaged. `}
            {recovery.interrupted.length > 0 &&
              `${recovery.interrupted.length} interrupted import${recovery.interrupted.length === 1 ? "" : "s"}.`}
          </span>
          <FolioButton variant="secondary" onClick={() => setRecoveryDialogOpen(true)}>
            Review
          </FolioButton>
        </div>
      )}

      {count > 0 && (
        <div
          className="folio-toolbar"
          role="group"
          aria-label="Library controls"
          style={{ paddingTop: 0, flexWrap: "wrap" }}
        >
          <FolioButton variant="primary" onClick={() => void onImport()} data-tour="import">
            <FolioIcons.Import size="sm" />
            Import
          </FolioButton>
          <div style={{ flex: 1 }} />
          <select
            className="folio-filter-select"
            value={filterCollection ?? ""}
            onChange={(e) => setFilterCollection(e.target.value || null)}
            aria-label="Filter by collection"
          >
            <option value="">All collections</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="folio-filter-select"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort"
          >
            <option value="recent">Recently read</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
          </select>
          <FolioChip
            selected={selectionMode}
            onClick={() => {
              if (selectionMode) setSelectedIds(new Set());
              setSelectionMode(!selectionMode);
            }}
          >
            Select
          </FolioChip>
          {selectionMode && selectedIds.size > 0 && (
            <>
              <span className="folio-selection-count" aria-live="polite">
                {selectedIds.size} selected
              </span>
              <FolioButton variant="secondary" onClick={() => setAddToCollectionOpen(true)}>
                Add to collection
              </FolioButton>
              <FolioButton variant="danger" onClick={() => setDeleteConfirmOpen(true)}>
                Delete
              </FolioButton>
            </>
          )}
        </div>
      )}

      <div
        className={`folio-screen${dragOver ? " folio-drop-target" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!hasBlockingOverlay()) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (hasBlockingOverlay()) return;
          void filesFromDataTransfer(e.dataTransfer).then((f) => {
            if (f.length > 0) void importPicked(f);
          });
        }}
      >
        {loadError && count > 0 && (
          <div className="folio-banner folio-banner--warning" role="alert">
            <span>{loadError}</span>
            <FolioButton variant="secondary" onClick={() => void refresh()}>
              Retry
            </FolioButton>
          </div>
        )}
        {loading ? (
          <div className="folio-empty">
            <div className="folio-empty__body">Loading…</div>
          </div>
        ) : loadError && count === 0 ? (
          <FolioEmptyState
            title="Library couldn't load"
            body={loadError}
            action={
              <FolioButton variant="secondary" onClick={() => void refresh()}>
                Retry
              </FolioButton>
            }
          />
        ) : count === 0 ? (
          <FolioEmptyState
            title={filterCollection ? "No books in this collection" : "Nothing here yet"}
            body={
              filterCollection
                ? "Add books to this collection from your library, or show all books."
                : "Import EPUB, HTML or TXT files to start your library. You can also drag files onto this window."
            }
            action={
              filterCollection ? (
                <FolioButton variant="secondary" onClick={() => setFilterCollection(null)}>
                  Show all books
                </FolioButton>
              ) : (
                <FolioButton
                  variant="primary"
                  onClick={() => void onImport()}
                  data-tour="import"
                >
                  Import a file
                </FolioButton>
              )
            }
          />
        ) : (
          <div role="list" aria-label="Documents">
            {visibleRows.map((r) => (
              <div role="listitem" key={r.id} className="folio-library-row">
                {selectionMode && (
                  <input
                    type="checkbox"
                    className="folio-library-row__check"
                    checked={selectedIds.has(r.id)}
                    onChange={(e) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                        return next;
                      });
                    }}
                  />
                )}
                <FolioBookRow
                  data={{
                    id: r.id,
                    title: r.title,
                    author: r.author ?? undefined,
                    kind: r.kind === "article" ? "Article" : "Book",
                    progress: r.percent === null ? undefined : r.percent / 100,
                    tint: r.tint,
                    coverUrl: r.coverUrl ?? undefined,
                  }}
                  actionLabel={
                    selectionMode
                      ? `${selectedIds.has(r.id) ? "Deselect" : "Select"} ${r.title}`
                      : undefined
                  }
                  onOpen={() =>
                    selectionMode
                      ? setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);
                          return next;
                        })
                      : openReader({ docId: r.id })
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <FolioDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title={`Delete ${selectedIds.size} document${selectedIds.size === 1 ? "" : "s"}?`}
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </FolioButton>
            <FolioButton
              variant="danger"
              disabled={deleting}
              onClick={async () => {
                if (deleting) return;
                setDeleting(true);
                const lm = getLibraryManager();
                const titles = new Map(rows.map((r) => [r.id, r.title]));
                const failures: string[] = [];
                let deleted = 0;
                try {
                  for (const id of selectedIds) {
                    try {
                      await lm.deleteDoc(id);
                      deleted += 1;
                    } catch (e) {
                      failures.push(
                        `${titles.get(id) ?? id}: ${e instanceof Error ? e.message : "Delete failed"}`
                      );
                    }
                  }
                } finally {
                  setSelectedIds(new Set());
                  setSelectionMode(false);
                  setDeleteConfirmOpen(false);
                  setDeleting(false);
                  await refresh();
                }
                if (failures.length > 0) {
                  pushToast({
                    tone: "error",
                    text: `Deleted ${deleted}, ${failures.length} failed`,
                    details: failures,
                  });
                } else if (deleted > 0) {
                  pushToast({
                    tone: "success",
                    text: `Deleted ${deleted} document${deleted === 1 ? "" : "s"}`,
                  });
                }
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </FolioButton>
          </>
        }
      >
        <p className="folio-helper">
          This will permanently remove the selected {selectedIds.size === 1 ? "document" : "documents"} and all associated notes from your library. This action cannot be undone.
        </p>
      </FolioDialog>

      <FolioDialog
        open={addToCollectionOpen}
        onClose={() => setAddToCollectionOpen(false)}
        title="Add to collection"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setAddToCollectionOpen(false)}>
              Cancel
            </FolioButton>
          </>
        }
      >
        <div className="folio-picker-list">
          {collections.map((c) => (
            <button
              key={c.id}
              type="button"
              className="folio-picker-row"
              onClick={() => void addToCollection(c.id)}
            >
              {c.name}
            </button>
          ))}
          {collections.length === 0 && <p className="folio-helper">No collections yet.</p>}
        </div>
      </FolioDialog>

      {/* Duplicate dialog (06 §1.6): Skip / Keep both / Replace */}
      <FolioDialog
        open={duplicate !== null}
        onClose={() => resolveDuplicate("skip")}
        title="Already in your library"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => resolveDuplicate("skip")}>
              Skip
            </FolioButton>
            <FolioButton variant="secondary" onClick={() => resolveDuplicate("keep")}>
              Keep both
            </FolioButton>
            <FolioButton variant="primary" onClick={() => resolveDuplicate("replace")}>
              Replace
            </FolioButton>
          </>
        }
      >
        <p>
          A document with the same content ({duplicate?.title}) already exists. Replace keeps the
          old position, notes and collections.
        </p>
      </FolioDialog>

      {/* Recovery dialog (06 §1.9) */}
      <FolioDialog
        open={recoveryDialogOpen}
        onClose={() => setRecoveryDialogOpen(false)}
        title="Library recovery"
        actions={
          <FolioButton variant="primary" onClick={() => setRecoveryDialogOpen(false)}>
            Done
          </FolioButton>
        }
      >
        {recovery?.damaged.map((d) => (
          <div key={d.id} className="folio-settings-row">
            <div className="folio-settings-row__body">
              <div className="folio-settings-row__title">{d.title}</div>
              <div className="folio-settings-row__helper">Damaged — remove the leftover files?</div>
            </div>
            <div className="folio-settings-row__control">
              <FolioButton
                variant="danger"
                onClick={() => {
                  void removeDamaged(d.id, d.slug);
                  setRecoveryDialogOpen(false);
                }}
              >
                Remove
              </FolioButton>
            </div>
          </div>
        ))}
        {recovery?.interrupted.map((d) => (
          <div key={d.slug} className="folio-settings-row">
            <div className="folio-settings-row__body">
              <div className="folio-settings-row__title">{d.slug}</div>
              <div className="folio-settings-row__helper">Interrupted import — delete leftover?</div>
            </div>
            <div className="folio-settings-row__control">
              <FolioButton
                variant="danger"
                onClick={() => {
                  void removeInterrupted(d.slug);
                  setRecoveryDialogOpen(false);
                }}
              >
                Delete
              </FolioButton>
            </div>
          </div>
        ))}
      </FolioDialog>

    </>
  );
}
