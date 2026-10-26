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

/** Library screen (03 §5.2) wired to the schema-1 library via LibraryManager. */
export function LibraryScreen() {
  const rows = useLibraryUi((s) => s.rows);
  const loading = useLibraryUi((s) => s.loading);
  const recovery = useLibraryUi((s) => s.recovery);
  const recoveryDialogOpen = useLibraryUi((s) => s.recoveryDialogOpen);
  const setRecoveryDialogOpen = useLibraryUi((s) => s.setRecoveryDialogOpen);
  const duplicate = useLibraryUi((s) => s.duplicate);
  const resolveDuplicate = useLibraryUi((s) => s.resolveDuplicate);
  const snackbar = useLibraryUi((s) => s.snackbar);
  const dismissSnackbar = useLibraryUi((s) => s.dismissSnackbar);
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
    () => localStorage.getItem("folio.library.sort") || "recent"
  );
  const [filterCollection, setFilterCollection] = useState<string | null>(null);
  const [collections, setCollections] = useState<{ id: string; name: string }[]>([]);
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { id: string; title: string; chapterTitle?: string; snippet: string; docId?: string }[]
  >([]);
  const searchIndexRef = useRef<MiniSearch | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildSearchIndex = useCallback(async () => {
    const lm = getLibraryManager();
    const manifest = await lm.load();
    const idx = new MiniSearch();
    for (const doc of manifest?.docs ?? []) {
      try {
        const raw = await getLibraryFs().readText(L.indexText(lm.root, doc.id));
        const parsed = JSON.parse(raw) as { chapters: { id: string; title: string; text: string }[] };
        for (const ch of parsed.chapters ?? []) {
          idx.add({
            id: `${doc.id}::${ch.id}`,
            title: doc.title,
            text: ch.text ?? "",
            docId: doc.id,
            chapterTitle: ch.title,
          });
        }
      } catch {
        /* no index yet */
      }
    }
    searchIndexRef.current = idx;
  }, []);

  const runSearch = useCallback((q: string) => {
    const idx = searchIndexRef.current;
    if (!idx || !q.trim()) {
      setSearchResults([]);
      return;
    }
    const hits = idx.search(q, 25);
    setSearchResults(
      hits.map((h) => ({
        id: h.id,
        title: h.chapterTitle ? h.chapterTitle : "Document",
        chapterTitle: h.chapterTitle,
        snippet: h.snippet,
        docId: h.docId,
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
  }, [searchQuery, runSearch]);
  const snackbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement)?.closest("input, textarea, select")) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  useEffect(() => {
    if (!snackbar || snackbar.tone === "busy") return;
    if (snackbarTimer.current) clearTimeout(snackbarTimer.current);
    snackbarTimer.current = setTimeout(dismissSnackbar, 4000);
    return () => {
      if (snackbarTimer.current) clearTimeout(snackbarTimer.current);
    };
  }, [snackbar, dismissSnackbar]);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (selectionMode && (e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setSelectedIds(new Set(rows.map((r) => r.id)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode, rows]);

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
    localStorage.setItem("folio.library.sort", sort);
  }, [sort]);

  const visibleRows = rows
    .filter((r) => (filterDocIds ? filterDocIds.has(r.id) : true))
    .slice()
    .sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "author") return (a.author ?? "").localeCompare(b.author ?? "");
      return 0;
    });

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
          onClick={() => setSearchOpen((v) => !v)}
        >
          <FolioIcons.Search />
        </button>
        <button type="button" className="folio-iconbtn" aria-label="Sort">
          <FolioIcons.Sort />
        </button>
        <button type="button" className="folio-iconbtn" aria-label="More">
          <FolioIcons.More />
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
                if (r.docId) openReader({ docId: r.docId });
                setSearchOpen(false);
                setSearchQuery("");
              }}
            >
              <div className="folio-searchresult__title">{r.title}</div>
              {r.chapterTitle && (
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

      <div className="folio-toolbar" role="group" aria-label="Library filters" style={{ paddingTop: 0 }}>
        <FolioChip selected>All</FolioChip>
        <FolioChip>#tag</FolioChip>
        <FolioChip>
          Collections
          <FolioIcons.ChevronDown size="sm" />
        </FolioChip>
        <div style={{ flex: 1 }} />
        <FolioButton variant="primary" onClick={() => void onImport()}>
          <FolioIcons.Import size="sm" />
          Import
        </FolioButton>
        <button
          type="button"
          className="folio-iconbtn folio-iconbtn--accent"
          aria-label="Import file"
          onClick={() => void onImport()}
        >
          <FolioIcons.Plus />
        </button>
      </div>

      <div className="folio-toolbar" role="group" aria-label="Library sort and selection" style={{ paddingTop: 0, flexWrap: "wrap" }}>
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
        <FolioChip selected={selectionMode} onClick={() => setSelectionMode((v) => !v)}>
          Select
        </FolioChip>
        {selectionMode && selectedIds.size > 0 && (
          <>
            <FolioButton variant="secondary" onClick={() => setAddToCollectionOpen(true)}>
              Add to collection
            </FolioButton>
            <FolioButton
              variant="danger"
              onClick={async () => {
                const lm = getLibraryManager();
                for (const id of selectedIds) await lm.deleteDoc(id);
                setSelectedIds(new Set());
                setSelectionMode(false);
                await refresh();
              }}
            >
              Delete
            </FolioButton>
          </>
        )}
      </div>

      <div
        className={`folio-screen${dragOver ? " folio-drop-target" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void filesFromDataTransfer(e.dataTransfer).then((f) => {
            if (f.length > 0) void importPicked(f);
          });
        }}
      >
        {loading ? (
          <div className="folio-empty">
            <div className="folio-empty__body">Loading…</div>
          </div>
        ) : count === 0 ? (
          <FolioEmptyState
            title="Nothing here yet"
            body="Import EPUB, HTML or TXT files to start your library. You can also drag files onto this window."
            action={<FolioButton variant="primary" onClick={() => void onImport()}>Import a file</FolioButton>}
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
                  }}
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

      {/* Progress / result snackbar */}
      {snackbar && (
        <div className={`folio-snackbar folio-snackbar--${snackbar.tone}`} role="status">
          {snackbar.text}
        </div>
      )}
    </>
  );
}
