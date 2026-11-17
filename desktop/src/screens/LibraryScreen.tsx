import { useCallback, useEffect, useRef, useState } from "react";
import { FolioButton } from "../components/FolioButton";
import { FolioChip } from "../components/FolioChip";
import { FolioIcons } from "../components/FolioIcons";
import { FolioEmptyState } from "../components/FolioEmptyState";
import { FolioSkeletonRows } from "../components/FolioSkeleton";
import { FolioBookRow } from "../components/FolioBookRow";
import { FolioDialog } from "../components/FolioDialog";
import { FolioMenu, type ViewportRect } from "../components/FolioMenu";
import { useLibraryUi, getLibraryFs, getLibraryManager } from "../store/libraryUi";
import { useRouteStore } from "../store/routeStore";
import {
  onDroppedFiles,
  pickImportFiles,
  pickImportFolder,
  filesFromDataTransfer,
} from "../lib/fileSource";
import { scanFolderForImport, FolderScanError } from "../lib/folderImport";
import { MiniSearch, type SearchDoc } from "../search/miniSearch";
import { buildLibraryIndex } from "../search/libraryIndex";
import { reportError } from "../lib/errorLog";
import { libraryLayout as L } from "../lib/libraryPaths";
import { readStorage, writeStorage } from "../lib/storage";
import { sortLibraryRows } from "../lib/libraryView";
import { searchSignature } from "../lib/searchCache";
import { hasBlockingOverlay } from "../shell/overlays";
import { pushToast } from "../shell/toasts";
import { handleError } from "../lib/errorLog";
import { nowIso } from "../model/ids";
import type { SnippetParts } from "../search/occurrences";
import type { LibraryRow } from "../store/libraryUi";

/** L1: windowed rendering only pays off on big shelves; below this, plain. */
const VIRTUAL_THRESHOLD = 120;

/** L8: a delete sits in a pending state this long, undoable the whole time. */
const SOFT_DELETE_MS = 10_000;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** "Today"/"Yesterday"/"3 days ago"/date, for the row's last-read line (L5). */
function relDay(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString();
}

/** "≈ 45 min left" / "≈ 1 h 25 min left" (L5). */
function fmtMinutesLeft(min: number): string {
  if (min < 60) return `≈ ${min} min left`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `≈ ${h} h left` : `≈ ${h} h ${m} min left`;
}

type KindFilter = "all" | "book" | "article";
type StatusFilter = "all" | "reading" | "finished" | "new";
type SearchScope = "all" | "book" | "article";

interface LibrarySearchResult {
  id: string;
  title: string;
  chapterTitle?: string;
  snippet: SnippetParts;
  docId?: string;
  location?: string;
}

/** Library screen (03 §5.2) wired to the schema-1 library via LibraryManager. */
export function LibraryScreen() {
  const rows = useLibraryUi((s) => s.rows);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const loading = useLibraryUi((s) => s.loading);
  const loadError = useLibraryUi((s) => s.error);
  const recovery = useLibraryUi((s) => s.recovery);
  const recoveryDialogOpen = useLibraryUi((s) => s.recoveryDialogOpen);
  const setRecoveryDialogOpen = useLibraryUi((s) => s.setRecoveryDialogOpen);
  const duplicate = useLibraryUi((s) => s.duplicate);
  const resolveDuplicate = useLibraryUi((s) => s.resolveDuplicate);
  const cancelDuplicate = useLibraryUi((s) => s.cancelDuplicate);
  const importProgress = useLibraryUi((s) => s.importProgress);
  const cancelImport = useLibraryUi((s) => s.cancelImport);
  const refreshing = useLibraryUi((s) => s.refreshing);
  const lastImportedIds = useLibraryUi((s) => s.lastImportedIds);
  const refresh = useLibraryUi((s) => s.refresh);
  const refreshDocs = useLibraryUi((s) => s.refreshDocs);
  const importPicked = useLibraryUi((s) => s.importPicked);
  const removeDamaged = useLibraryUi((s) => s.removeDamaged);
  const removeInterrupted = useLibraryUi((s) => s.removeInterrupted);
  const openReader = useRouteStore((s) => s.openReader);
  const [dragOver, setDragOver] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterDocIds, setFilterDocIds] = useState<Set<string> | null>(null);
  const [sort, setSort] = useState<string>(() => readStorage("folio.library.sort") || "recent");
  const [filterCollection, setFilterCollection] = useState<string | null>(null);
  const [collections, setCollections] = useState<{ id: string; name: string }[]>([]);
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [searchResults, setSearchResults] = useState<LibrarySearchResult[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const searchIndexRef = useRef<{ signature: string; index: MiniSearch } | null>(null);
  const [searchIndexVersion, setSearchIndexVersion] = useState(0);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- L5: view + filters --------------------------------------------------
  const [view, setView] = useState<"list" | "grid">(() =>
    readStorage("folio.library.view") === "grid" ? "grid" : "list",
  );
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // ---- L4: per-book menu + edit details ------------------------------------
  const [menuDocId, setMenuDocId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<ViewportRect | null>(null);
  const [editDocId, setEditDocId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ title: "", author: "", tags: "", kind: "book" });
  const [editSaving, setEditSaving] = useState(false);

  // ---- L8: soft delete (pending window with Undo) ---------------------------
  const [pendingDeletes, setPendingDeletes] = useState<
    Map<string, { title: string; timer: number }>
  >(new Map());
  const pendingDeletesRef = useRef(pendingDeletes);
  pendingDeletesRef.current = pendingDeletes;

  // ---- L7: inline "New collection…" inside the Add-to-collection picker ----
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionError, setNewCollectionError] = useState<string | null>(null);
  const [creatingCollection, setCreatingCollection] = useState(false);

  // ---- L10: "apply to all remaining" for duplicate imports ------------------
  const [duplicateApplyAll, setDuplicateApplyAll] = useState(false);

  const buildSearchIndex = useCallback(async () => {
    const signature = searchSignature(rows);
    const cached = searchIndexRef.current;
    if (cached && cached.signature === signature) return;

    const lm = getLibraryManager();
    const docs: SearchDoc[] = [];
    let failed = 0;
    setIndexProgress({ done: 0, total: rows.length });
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
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
          docs.push({
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
        failed += 1;
      }
      setIndexProgress({ done: i + 1, total: rows.length });
    }

    // Tokenization + posting construction run in a worker when available.
    const built = await buildLibraryIndex(docs);
    if (failed > 0) {
      reportError(
        `${failed} document${failed === 1 ? "" : "s"} had no search index`,
        "library.searchIndex",
      );
    }
    // Rows changed while building: discard, the next effect run rebuilds.
    if (searchSignature(rowsRef.current) !== signature) return;
    searchIndexRef.current = { signature, index: built.index };
    // Results typed while the index was building must run against it.
    setSearchIndexVersion((v) => v + 1);
    setIndexProgress(null);
  }, [rows]);

  const runSearch = useCallback(
    (q: string) => {
      const idx = searchIndexRef.current?.index;
      if (!idx || !q.trim()) {
        setSearchResults([]);
        return;
      }
      const kindByDoc = new Map(rowsRef.current.map((r) => [r.id, r.kind]));
      const hits = idx.search(q, 25).filter((h) => {
        if (searchScope === "all") return true;
        const kind = h.docId ? kindByDoc.get(h.docId) : undefined;
        return kind === searchScope;
      });
      setSearchResults(
        hits.map((h) => ({
          id: h.id,
          title: h.docTitle ?? "Document",
          chapterTitle: h.chapterTitle,
          snippet: h.snippet,
          docId: h.docId,
          location: h.href,
        })),
      );
    },
    [searchScope],
  );

  useEffect(() => {
    if (!searchOpen) return;
    void buildSearchIndex();
  }, [searchOpen, buildSearchIndex]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setActiveResultIndex(-1);
      runSearch(searchQuery);
    }, 250);
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
    (async () => {
      try {
        const lm = getLibraryManager();
        const list = await lm.collections.list();
        setCollections(list.map((c) => ({ id: c.id, name: c.name })));
      } catch (e) {
        handleError(e, { context: "library.collections" });
      }
    })();
  }, []);

  // Tauri drag-and-drop: the webview event drives the over/leave visuals,
  // while the actual drop arrives via `folio://drop-granted` — Rust grants
  // the paths before emitting, so the webview never handles a raw path.
  // HTML5 dnd is the browser fallback.
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
            // Paths are handled by the granted event below.
          }
        });
        if (cancelled) un();
        else unlisten = un;
      } catch {
        /* not in Tauri — HTML5 handlers cover it */
      }
    })();
    let unDrop: (() => void) | undefined;
    let dropCancelled = false;
    void onDroppedFiles((files) => {
      // The tour, onboarding and dialogs own the window; a drop must
      // not import underneath them.
      if (hasBlockingOverlay()) return;
      void importPicked(files);
    }).then((un) => {
      if (dropCancelled) un();
      else unDrop = un;
    });
    return () => {
      cancelled = true;
      dropCancelled = true;
      unlisten?.();
      unDrop?.();
    };
  }, [importPicked]);

  const onImport = useCallback(async () => {
    const files = await pickImportFiles();
    await importPicked(files);
  }, [importPicked]);

  // F7: folder import — one granted directory → recursive walk → the same
  // import queue. Scan failures (no importable files, >500 cap) are toasts,
  // never thrown at the screen.
  const onImportFolder = useCallback(async () => {
    const folder = await pickImportFolder();
    if (!folder) return;
    try {
      const scan = await scanFolderForImport(getLibraryFs(), folder);
      await importPicked(scan.files);
      if (scan.truncated) {
        pushToast({
          tone: "info",
          text: "The first 500 files were imported; import the rest in parts.",
        });
      } else if (scan.skippedCount > 0) {
        pushToast({
          tone: "info",
          text: `${scan.skippedCount} folder(s) could not be read and were skipped.`,
        });
      }
    } catch (e) {
      if (e instanceof FolderScanError) {
        pushToast({ tone: "error", text: e.message });
      } else {
        reportError(e, "library.importFolder");
        pushToast({ tone: "error", text: "The folder could not be read." });
      }
    }
  }, [importPicked]);

  // Global library keys (07 §1 matrix): "/" and Ctrl+F search, Ctrl+I import.
  // Declared after `onImport` so the dependency is complete without disables.
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
  }, [onImport]);

  // ---- L5 + L8: filtered + sorted shelf ------------------------------------
  // Pending (undoable) deletions are hidden from the shelf immediately; they
  // only disappear for real once their timer fires.
  const filteredRows = rows.filter(
    (r) =>
      !pendingDeletes.has(r.id) &&
      (filterDocIds ? filterDocIds.has(r.id) : true) &&
      (kindFilter === "all" || r.kind === kindFilter) &&
      (statusFilter === "all" ||
        (statusFilter === "new" && r.percent === null) ||
        (statusFilter === "finished" && (r.percent ?? 0) >= 100) ||
        (statusFilter === "reading" && r.percent !== null && r.percent < 100)) &&
      (tagFilter === null || r.tags.includes(tagFilter)),
  );
  const visibleRows = sortLibraryRows(filteredRows, sort);

  // L5: the Continue-reading shelf — in-progress books, most recent first.
  const shelfRows = sortLibraryRows(
    rows.filter(
      (r) =>
        !pendingDeletes.has(r.id) &&
        (filterDocIds ? filterDocIds.has(r.id) : true) &&
        r.percent !== null &&
        r.percent > 0 &&
        r.percent < 100,
    ),
    "recent",
  ).slice(0, 8);

  const allTags: string[] = [];
  for (const r of rows) {
    for (const t of r.tags) {
      if (!allTags.includes(t)) allTags.push(t);
    }
  }
  allTags.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  // N2: docs whose folder/meta vanished (recovery "damaged") cannot be opened;
  // their rows offer Delete/Export-style actions only.
  const missingIds = new Set((recovery?.damaged ?? []).map((d) => d.id));

  // Toolbar count is the library total; the "N of M" form only shows while a
  // filter actually narrows the list, so the number never jumps confusingly.
  const total = rows.length;
  const count = visibleRows.length;
  const filtered =
    count !== total ||
    kindFilter !== "all" ||
    statusFilter !== "all" ||
    tagFilter !== null ||
    filterCollection !== null;

  useEffect(() => {
    writeStorage("folio.library.view", view);
  }, [view]);

  useEffect(() => {
    writeStorage("folio.library.sort", sort);
  }, [sort]);

  // ---- L1: windowed rendering for very large shelves -----------------------
  // The rows scroll inside `.folio-screen`; the window tracks its scrollTop
  // with spacer divs preserving the total height. Measured row pitch (first
  // two rows' offsetTop distance) keeps the math honest across themes/zoom.
  // Grid tiles have free-form heights, so windowing stays list-only.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowPitchRef = useRef(96);
  const visibleRowsRef = useRef(visibleRows);
  visibleRowsRef.current = visibleRows;
  const [virtual, setVirtual] = useState({ start: 0, end: VIRTUAL_THRESHOLD });
  const virtualized = view === "list" && count > VIRTUAL_THRESHOLD;

  useEffect(() => {
    if (!virtualized) {
      setVirtual({ start: 0, end: count });
      return;
    }
    const sc = scrollRef.current;
    if (!sc) return;
    const measure = () => {
      const els = sc.querySelectorAll<HTMLElement>(".folio-library-row");
      if (els.length >= 2) {
        rowPitchRef.current = Math.max(48, els[1].offsetTop - els[0].offsetTop);
      } else if (els.length === 1) {
        rowPitchRef.current = Math.max(48, els[0].offsetHeight + 8);
      }
      const pitch = rowPitchRef.current;
      const start = Math.max(0, Math.floor(sc.scrollTop / pitch) - 6);
      const end = Math.min(count, start + Math.ceil(sc.clientHeight / pitch) + 12);
      setVirtual((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    measure();
    sc.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(sc);
    return () => {
      sc.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [virtualized, count, sort, filterDocIds, searchQuery, view]);

  // L3: highlight freshly imported rows and bring the first into view.
  useEffect(() => {
    if (lastImportedIds.length === 0) return;
    const firstId = lastImportedIds[0];
    // Under windowing, the row may not be mounted yet — center it first.
    const idx = visibleRowsRef.current.findIndex((r) => r.id === firstId);
    const sc = scrollRef.current;
    if (idx >= 0 && sc && virtualized && rowPitchRef.current > 0) {
      sc.scrollTop = Math.max(0, idx * rowPitchRef.current - sc.clientHeight / 2);
    }
    // Paint happens after the state commit; a macrotask sees the real row.
    const scrollTimer = setTimeout(() => {
      document
        .querySelector(`[data-doc-id="${CSS.escape(firstId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, 0);
    const clearTimer = setTimeout(() => useLibraryUi.setState({ lastImportedIds: [] }), 6000);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [lastImportedIds, virtualized]);

  // A filter or search change invalidates the old selection: acting on hidden
  // rows is how Ctrl+A used to delete books the user could not see.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterCollection, searchQuery, kindFilter, statusFilter, tagFilter]);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(visibleRowsRef.current.map((r) => r.id)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hasBlockingOverlay()) return;
      if (selectionMode && (e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        selectAllVisible();
      } else if (selectionMode && e.key === "Escape") {
        e.preventDefault();
        setSelectionMode(false);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode, selectAllVisible]);

  // ---- L8: soft delete with Undo -------------------------------------------
  // The deletion is scheduled SOFT_DELETE_MS out; the shelf hides the row
  // immediately, and an Undo (toast button or the pending strip) cancels it.
  const commitDelete = useCallback(async (id: string, doRefresh = true) => {
    const pending = pendingDeletesRef.current.get(id);
    if (pending) window.clearTimeout(pending.timer);
    setPendingDeletes((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    try {
      await getLibraryManager().deleteDoc(id);
      pushToast({ tone: "success", text: "Deleted" });
    } catch (e) {
      handleError(e, { context: "library.delete" });
      pushToast({
        tone: "error",
        text: "Delete failed",
        details: [e instanceof Error ? e.message : "Delete failed"],
      });
    }
    if (doRefresh) await useLibraryUi.getState().refresh();
  }, []);

  const undoDelete = useCallback((ids: string[]) => {
    setPendingDeletes((prev) => {
      const next = new Map(prev);
      for (const id of ids) {
        const pending = next.get(id);
        if (pending) window.clearTimeout(pending.timer);
        next.delete(id);
      }
      return next;
    });
  }, []);

  // Pending deletions must still happen when the screen goes away.
  const pendingRef = useRef({ commitDelete, undoDelete });
  pendingRef.current = { commitDelete, undoDelete };
  useEffect(
    () => () => {
      for (const id of [...pendingDeletesRef.current.keys()]) {
        void pendingRef.current.commitDelete(id, false);
      }
    },
    [],
  );

  const scheduleDelete = useCallback(
    (ids: string[]) => {
      const titles = new Map(rowsRef.current.map((r) => [r.id, r.title]));
      setPendingDeletes((prev) => {
        const next = new Map(prev);
        for (const id of ids) {
          if (next.has(id)) continue;
          const title = titles.get(id) ?? id;
          next.set(id, {
            title,
            timer: window.setTimeout(() => void commitDelete(id), SOFT_DELETE_MS),
          });
        }
        return next;
      });
      const label =
        ids.length === 1
          ? `“${titles.get(ids[0]) ?? ids[0]}” will be deleted`
          : `${ids.length} documents will be deleted`;
      pushToast({
        tone: "success",
        text: label,
        action: { label: "Undo", run: () => undoDelete(ids) },
      });
    },
    [commitDelete, undoDelete],
  );

  const addToCollection = async (collectionId: string, ids: string[]) => {
    const lm = getLibraryManager();
    await lm.mutateCollectionDocs(collectionId, { add: ids });
    setAddToCollectionOpen(false);
    setSelectedIds(new Set());
    setSelectionMode(false);
    await refresh();
  };

  // ---- L7: inline "New collection…" inside the picker -----------------------
  const createCollectionInline = async () => {
    if (creatingCollection) return;
    const name = newCollectionName.trim();
    if (!name) {
      setNewCollectionError("Give the collection a name.");
      return;
    }
    if (collections.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
      setNewCollectionError("A collection with this name already exists.");
      return;
    }
    setCreatingCollection(true);
    try {
      const lm = getLibraryManager();
      const created = await lm.createCollection(name);
      const list = await lm.collections.list();
      setCollections(list.map((c) => ({ id: c.id, name: c.name })));
      setNewCollectionName("");
      setNewCollectionError(null);
      await addToCollection(created.id, [...selectedIds]);
    } catch (e) {
      handleError(e, { context: "library.collection.create" });
      setNewCollectionError(
        e instanceof Error ? e.message : "The collection could not be created.",
      );
    } finally {
      setCreatingCollection(false);
    }
  };

  // ---- L4: per-book menu ----------------------------------------------------
  const menuRow = menuDocId ? (rows.find((r) => r.id === menuDocId) ?? null) : null;
  const openMenu = (row: LibraryRow, trigger: HTMLElement) => {
    setMenuAnchor(trigger.getBoundingClientRect());
    setMenuDocId(row.id);
  };
  const startEdit = (row: LibraryRow) => {
    setEditDraft({
      title: row.title,
      author: row.author ?? "",
      tags: row.tags.join(", "),
      kind: row.kind,
    });
    setEditDocId(row.id);
  };
  const saveEdit = async () => {
    if (!editDocId || editSaving) return;
    const title = editDraft.title.trim();
    if (!title) return;
    const tags = [
      ...new Set(
        editDraft.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => (t.length > 40 ? t.slice(0, 40) : t)),
      ),
    ].slice(0, 20);
    setEditSaving(true);
    try {
      await getLibraryManager().updateMeta(editDocId, {
        title,
        author: editDraft.author.trim() || null,
        tags,
        kind: editDraft.kind === "article" ? "article" : "book",
      });
      setEditDocId(null);
      await refresh();
      pushToast({ tone: "success", text: "Details saved" });
    } catch (e) {
      handleError(e, { context: "library.editDetails" });
      pushToast({
        tone: "error",
        text: "Details could not be saved",
        details: [e instanceof Error ? e.message : "Save failed"],
      });
    } finally {
      setEditSaving(false);
    }
  };
  const markFinished = async (row: LibraryRow) => {
    try {
      const lm = getLibraryManager();
      const existing = await lm.progress.get(row.id);
      await lm.progress.put({
        docId: row.id,
        location: existing?.location ?? "",
        percent: 100,
        updatedAt: nowIso(),
        pace: existing?.pace ?? null,
      });
      await refreshDocs([row.id]);
      pushToast({ tone: "success", text: `“${row.title}” marked as finished` });
    } catch (e) {
      handleError(e, { context: "library.markFinished" });
    }
  };
  const showInFolder = async (row: LibraryRow) => {
    if (!isTauri()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("reveal_doc", { slug: row.slug });
    } catch (e) {
      handleError(e, { context: "library.reveal" });
    }
  };

  const menuItems = menuRow
    ? [
        ...(missingIds.has(menuRow.id)
          ? []
          : [
              {
                key: "open",
                label: "Open",
                onSelect: () => openReader({ docId: menuRow.id }),
              },
            ]),
        {
          key: "collection",
          label: "Add to collection…",
          disabled: selectedIds.size > 0,
          onSelect: () => {
            setSelectedIds(new Set([menuRow.id]));
            setAddToCollectionOpen(true);
          },
        },
        {
          key: "edit",
          label: "Edit details…",
          onSelect: () => startEdit(menuRow),
        },
        ...(missingIds.has(menuRow.id) || (menuRow.percent ?? 0) >= 100
          ? []
          : [
              {
                key: "finish",
                label: "Mark finished",
                onSelect: () => void markFinished(menuRow),
              },
            ]),
        ...(isTauri() && !missingIds.has(menuRow.id)
          ? [
              {
                key: "folder",
                label: "Show in folder",
                onSelect: () => void showInFolder(menuRow),
              },
            ]
          : []),
        {
          key: "delete",
          label: "Delete…",
          danger: true,
          separatorBefore: true,
          onSelect: () => scheduleDelete([menuRow.id]),
        },
      ]
    : [];

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
      } catch (e) {
        handleError(e, { context: "library.filter" });
        setFilterDocIds(null);
      }
    })();
  }, [filterCollection]);

  const searchActive = searchOpen && searchQuery.trim().length > 0 && indexProgress === null;
  const noResults = searchActive && searchResults.length === 0;

  const openSearchResult = (r: LibrarySearchResult) => {
    if (r.docId) {
      openReader({ docId: r.docId, location: r.location ?? null });
    }
    setSearchOpen(false);
    setSearchQuery("");
  };

  const renderSnippet = (snippet: SnippetParts) => (
    <>
      {snippet.head ? "…" : null}
      {snippet.parts.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : p.text))}
      {snippet.tail ? "…" : null}
    </>
  );

  const rowMetaLine = (r: LibraryRow): string | undefined => {
    const parts: string[] = [];
    if (r.lastReadAt) parts.push(`Last read ${relDay(r.lastReadAt)}`);
    if (r.minutesLeft !== null) parts.push(fmtMinutesLeft(r.minutesLeft));
    return parts.length > 0 ? parts.join(" · ") : undefined;
  };

  const rowBadge = (r: LibraryRow): "New" | "Finished" | "Missing" | undefined =>
    missingIds.has(r.id)
      ? "Missing"
      : r.percent === null
        ? "New"
        : r.percent >= 100
          ? "Finished"
          : undefined;

  return (
    <>
      <header className="folio-toolbar">
        <div className="folio-toolbar__titles">
          <div className="folio-toolbar__title">Library</div>
          <div className="folio-toolbar__subtitle">
            {filtered
              ? `${count} of ${total} document${total === 1 ? "" : "s"}`
              : `${count} document${count === 1 ? "" : "s"}`}
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
            role="combobox"
            aria-expanded={searchResults.length > 0}
            aria-controls="folio-library-search-results"
            aria-activedescendant={
              activeResultIndex >= 0 && activeResultIndex < searchResults.length
                ? `folio-library-search-opt-${activeResultIndex}`
                : undefined
            }
            aria-label="Search your library"
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setSearchOpen(false);
                setSearchQuery("");
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveResultIndex((i) => Math.min(i + 1, searchResults.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveResultIndex((i) => Math.max(i - 1, -1));
              } else if (e.key === "Enter") {
                const target = searchResults[activeResultIndex] ?? searchResults[0];
                if (target) {
                  e.preventDefault();
                  openSearchResult(target);
                }
              }
            }}
            autoFocus
          />
        </div>
      )}

      {searchOpen && indexProgress && indexProgress.done < indexProgress.total && (
        <div className="folio-searchbar__progress" role="status">
          <span
            className="folio-reader-spinner"
            style={{ width: 14, height: 14, borderWidth: 2 }}
          />
          <span>
            Indexing {indexProgress.done} of {indexProgress.total} document
            {indexProgress.total === 1 ? "" : "s"}…
          </span>
        </div>
      )}

      {searchOpen && searchQuery.trim().length > 0 && indexProgress === null && (
        <div className="folio-searchbar__progress" role="status" aria-live="polite">
          {searchResults.length > 0
            ? `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`
            : null}
        </div>
      )}

      {searchOpen && searchQuery.trim().length > 0 && indexProgress === null && (
        <div
          className="folio-toolbar"
          role="group"
          aria-label="Search scope"
          style={{ paddingTop: 0 }}
        >
          {(["all", "book", "article"] as SearchScope[]).map((s) => (
            <FolioChip key={s} selected={searchScope === s} onClick={() => setSearchScope(s)}>
              {s === "all" ? "All" : s === "book" ? "Books" : "Articles"}
            </FolioChip>
          ))}
        </div>
      )}

      {noResults && (
        <div className="folio-searchresults">
          <p className="folio-helper" role="status">
            No results for “{searchQuery.trim()}”.
          </p>
        </div>
      )}

      {searchOpen && searchResults.length > 0 && (
        <div
          id="folio-library-search-results"
          className="folio-searchresults"
          role="listbox"
          aria-label="Search results"
        >
          {searchResults.map((r, i) => (
            <button
              key={r.id}
              id={`folio-library-search-opt-${i}`}
              type="button"
              role="option"
              aria-selected={i === activeResultIndex}
              className={`folio-searchresult${i === activeResultIndex ? " is-active" : ""}`}
              onClick={() => openSearchResult(r)}
            >
              <div className="folio-searchresult__title">{r.title}</div>
              {r.chapterTitle && r.chapterTitle !== r.title && (
                <div className="folio-searchresult__chapter">{r.chapterTitle}</div>
              )}
              {/* L9: structured snippet — React nodes, no raw HTML. */}
              <div className="folio-searchresult__snippet">{renderSnippet(r.snippet)}</div>
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
          <button
            type="button"
            className="folio-iconbtn"
            aria-label="Import folder…"
            title="Import folder…"
            onClick={() => void onImportFolder()}
          >
            <FolioIcons.Folder size="sm" />
          </button>
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
            <option value="recent">Recent activity</option>
            <option value="dateadded">Date added</option>
            <option value="progress">Progress</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
          </select>
          <div role="group" aria-label="View" style={{ display: "inline-flex", gap: 4 }}>
            <button
              type="button"
              className="folio-iconbtn"
              aria-label="List view"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <FolioIcons.ListRows size="sm" />
            </button>
            <button
              type="button"
              className="folio-iconbtn"
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
            >
              <FolioIcons.Grid size="sm" />
            </button>
          </div>
          <FolioChip
            selected={selectionMode}
            onClick={() => {
              if (selectionMode) setSelectedIds(new Set());
              setSelectionMode(!selectionMode);
            }}
          >
            Select
          </FolioChip>
          {selectionMode && (
            <FolioChip
              selected={selectedIds.size === visibleRows.length && visibleRows.length > 0}
              onClick={selectAllVisible}
            >
              Select all
            </FolioChip>
          )}
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

      {count > 0 && (
        <div
          className="folio-toolbar"
          role="group"
          aria-label="Filters"
          style={{ paddingTop: 0, flexWrap: "wrap" }}
        >
          <FolioChip selected={kindFilter === "all"} onClick={() => setKindFilter("all")}>
            All
          </FolioChip>
          <FolioChip selected={kindFilter === "book"} onClick={() => setKindFilter("book")}>
            Books
          </FolioChip>
          <FolioChip selected={kindFilter === "article"} onClick={() => setKindFilter("article")}>
            Articles
          </FolioChip>
          <FolioChip
            selected={statusFilter === "reading"}
            onClick={() => setStatusFilter(statusFilter === "reading" ? "all" : "reading")}
          >
            Reading
          </FolioChip>
          <FolioChip
            selected={statusFilter === "finished"}
            onClick={() => setStatusFilter(statusFilter === "finished" ? "all" : "finished")}
          >
            Finished
          </FolioChip>
          <FolioChip
            selected={statusFilter === "new"}
            onClick={() => setStatusFilter(statusFilter === "new" ? "all" : "new")}
          >
            New
          </FolioChip>
          {allTags.slice(0, 6).map((t) => (
            <FolioChip
              key={t}
              selected={tagFilter === t}
              onClick={() => setTagFilter(tagFilter === t ? null : t)}
            >
              #{t}
            </FolioChip>
          ))}
        </div>
      )}

      {/* L8: pending (undoable) deletions strip */}
      {pendingDeletes.size > 0 && (
        <div className="folio-pending-strip" role="status">
          {[...pendingDeletes.entries()].map(([id, p]) => (
            <span key={id} className="folio-pending-strip__item">
              Deleting “{p.title}”
              <button
                type="button"
                className="folio-btn folio-btn--secondary folio-btn--sm"
                onClick={() => undoDelete([id])}
              >
                Undo
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
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
        {refreshing && count > 0 && (
          <div className="folio-refresh-bar" role="progressbar" aria-label="Updating library" />
        )}
        {loadError && count > 0 && (
          <div className="folio-banner folio-banner--warning" role="alert">
            <span>{loadError}</span>
            <FolioButton variant="secondary" onClick={() => void refresh()}>
              Retry
            </FolioButton>
          </div>
        )}
        {loading ? (
          <FolioSkeletonRows view={view} />
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
            title={
              filterCollection || kindFilter !== "all" || statusFilter !== "all" || tagFilter
                ? "No books match these filters"
                : "Nothing here yet"
            }
            body={
              filterCollection || kindFilter !== "all" || statusFilter !== "all" || tagFilter
                ? "Try removing a filter, or import something new."
                : "Import EPUB, PDF, HTML or TXT files to start your library. You can also drag files onto this window."
            }
            action={
              filterCollection || kindFilter !== "all" || statusFilter !== "all" || tagFilter ? (
                <FolioButton
                  variant="secondary"
                  onClick={() => {
                    setKindFilter("all");
                    setStatusFilter("all");
                    setTagFilter(null);
                    setFilterCollection(null);
                  }}
                >
                  Clear filters
                </FolioButton>
              ) : (
                <FolioButton variant="primary" onClick={() => void onImport()} data-tour="import">
                  Import a file
                </FolioButton>
              )
            }
          />
        ) : (
          <>
            {/* L5: Continue-reading shelf (list view only) */}
            {view === "list" && shelfRows.length > 0 && (
              <div className="folio-shelf" aria-label="Continue reading">
                <div className="folio-shelf__label">Continue reading</div>
                <div className="folio-shelf__rows" role="list">
                  {shelfRows.map((r) => (
                    <div role="listitem" key={`shelf-${r.id}`} data-doc-id={`shelf-${r.id}`}>
                      <FolioBookRow
                        data={{
                          id: r.id,
                          title: r.title,
                          author: r.author ?? undefined,
                          format: r.format,
                          progress: (r.percent ?? 0) / 100,
                          tint: r.tint,
                          coverUrl: r.coverUrl ?? undefined,
                          badge: rowBadge(r),
                          metaLine: rowMetaLine(r),
                        }}
                        onOpen={() => openReader({ docId: r.id })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {view === "grid" ? (
              <div className="folio-library-grid" role="list" aria-label="Documents">
                {visibleRows.map((r) => (
                  <div
                    role="listitem"
                    key={r.id}
                    data-doc-id={r.id}
                    className={`folio-library-row folio-library-row--grid${
                      lastImportedIds.includes(r.id) ? " folio-library-row--new" : ""
                    }`}
                  >
                    {selectionMode && (
                      <input
                        type="checkbox"
                        className="folio-library-row__check"
                        aria-label={`Select ${r.title}`}
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
                      variant="card"
                      data={{
                        id: r.id,
                        title: r.title,
                        author: r.author ?? undefined,
                        kind: r.kind === "article" ? "Article" : "Book",
                        format: r.format,
                        progress: r.percent === null ? undefined : r.percent / 100,
                        tint: r.tint,
                        coverUrl: r.coverUrl ?? undefined,
                        badge: rowBadge(r),
                      }}
                      actionLabel={
                        selectionMode
                          ? `${selectedIds.has(r.id) ? "Deselect" : "Select"} ${r.title}`
                          : undefined
                      }
                      onOpen={
                        missingIds.has(r.id)
                          ? undefined
                          : () =>
                              selectionMode
                                ? setSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(r.id)) next.delete(r.id);
                                    else next.add(r.id);
                                    return next;
                                  })
                                : openReader({ docId: r.id })
                      }
                      onMore={
                        selectionMode
                          ? undefined
                          : (id, trigger) => {
                              const row = rows.find((x) => x.id === id);
                              if (row) openMenu(row, trigger);
                            }
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div role="list" aria-label="Documents">
                {virtualized && virtual.start > 0 && (
                  <div aria-hidden="true" style={{ height: virtual.start * rowPitchRef.current }} />
                )}
                {(virtualized ? visibleRows.slice(virtual.start, virtual.end) : visibleRows).map(
                  (r) => (
                    <div
                      role="listitem"
                      key={r.id}
                      data-doc-id={r.id}
                      className={`folio-library-row${
                        lastImportedIds.includes(r.id) ? " folio-library-row--new" : ""
                      }`}
                    >
                      {selectionMode && (
                        <input
                          type="checkbox"
                          className="folio-library-row__check"
                          aria-label={`Select ${r.title}`}
                          checked={selectedIds.has(r.id)}
                          onChange={(e) => {
                            // L8: Shift-click selects a visible range.
                            if ((e.nativeEvent as MouseEvent).shiftKey) {
                              const ids = visibleRowsRef.current.map((x) => x.id);
                              const end = ids.indexOf(r.id);
                              const last = [...selectedIds].find((id) => ids.includes(id));
                              const start = last !== undefined ? ids.indexOf(last) : end;
                              const [lo, hi] = start <= end ? [start, end] : [end, start];
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                for (let i = lo; i <= hi; i++) next.add(ids[i]);
                                return next;
                              });
                              return;
                            }
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
                          format: r.format,
                          progress: r.percent === null ? undefined : r.percent / 100,
                          tint: r.tint,
                          coverUrl: r.coverUrl ?? undefined,
                          badge: rowBadge(r),
                          metaLine: rowMetaLine(r),
                        }}
                        actionLabel={
                          selectionMode
                            ? `${selectedIds.has(r.id) ? "Deselect" : "Select"} ${r.title}`
                            : undefined
                        }
                        onOpen={
                          missingIds.has(r.id)
                            ? undefined
                            : () =>
                                selectionMode
                                  ? setSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(r.id)) next.delete(r.id);
                                      else next.add(r.id);
                                      return next;
                                    })
                                  : openReader({ docId: r.id })
                        }
                        onMore={selectionMode ? undefined : (_id, trigger) => openMenu(r, trigger)}
                      />
                    </div>
                  ),
                )}
                {virtualized && virtual.end < count && (
                  <div
                    aria-hidden="true"
                    style={{ height: (count - virtual.end) * rowPitchRef.current }}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <FolioMenu
        anchorRect={menuAnchor}
        items={menuItems}
        label={menuRow ? `Actions for ${menuRow.title}` : "Actions"}
        onClose={() => {
          setMenuDocId(null);
          setMenuAnchor(null);
        }}
      />

      {/* L4: edit details */}
      <FolioDialog
        open={editDocId !== null}
        onClose={() => (editSaving ? undefined : setEditDocId(null))}
        title="Edit details"
        actions={
          <>
            <FolioButton
              variant="secondary"
              onClick={() => setEditDocId(null)}
              disabled={editSaving}
            >
              Cancel
            </FolioButton>
            <FolioButton
              variant="primary"
              onClick={() => void saveEdit()}
              disabled={editSaving || editDraft.title.trim().length === 0}
            >
              {editSaving ? "Saving…" : "Save"}
            </FolioButton>
          </>
        }
      >
        <form
          className="folio-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveEdit();
          }}
        >
          <label className="folio-form__field">
            <span>Title</span>
            <input
              type="text"
              className="folio-note-input"
              style={{ minHeight: 44 }}
              value={editDraft.title}
              maxLength={200}
              onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
              data-autofocus
            />
          </label>
          <label className="folio-form__field">
            <span>Author</span>
            <input
              type="text"
              className="folio-note-input"
              style={{ minHeight: 44 }}
              value={editDraft.author}
              maxLength={120}
              onChange={(e) => setEditDraft((d) => ({ ...d, author: e.target.value }))}
            />
          </label>
          <label className="folio-form__field">
            <span>Tags (comma-separated)</span>
            <input
              type="text"
              className="folio-note-input"
              style={{ minHeight: 44 }}
              value={editDraft.tags}
              maxLength={200}
              placeholder="fiction, space"
              onChange={(e) => setEditDraft((d) => ({ ...d, tags: e.target.value }))}
            />
          </label>
          <label className="folio-form__field">
            <span>Kind</span>
            <select
              className="folio-filter-select"
              value={editDraft.kind}
              aria-label="Kind"
              onChange={(e) => setEditDraft((d) => ({ ...d, kind: e.target.value }))}
            >
              <option value="book">Book</option>
              <option value="article">Article</option>
            </select>
          </label>
        </form>
      </FolioDialog>

      {/* L8: delete confirmation with the affected titles */}
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
              onClick={() => {
                setDeleteConfirmOpen(false);
                scheduleDelete([...selectedIds]);
                setSelectedIds(new Set());
                setSelectionMode(false);
              }}
            >
              Delete
            </FolioButton>
          </>
        }
      >
        <p className="folio-helper">
          These documents will be removed from your shelf. You have a moment to undo.
        </p>
        <ul className="folio-delete-titles">
          {[...selectedIds].map((id) => (
            <li key={id}>{rows.find((r) => r.id === id)?.title ?? id}</li>
          ))}
        </ul>
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
              onClick={() => void addToCollection(c.id, [...selectedIds])}
            >
              {c.name}
            </button>
          ))}
          {collections.length === 0 && <p className="folio-helper">No collections yet.</p>}
          {/* L7: create + add in one step */}
          <form
            className="folio-form folio-picker__new"
            onSubmit={(e) => {
              e.preventDefault();
              void createCollectionInline();
            }}
          >
            <input
              type="text"
              className="folio-note-input"
              style={{ minHeight: 44 }}
              value={newCollectionName}
              maxLength={80}
              placeholder="New collection…"
              aria-label="New collection name"
              onChange={(e) => {
                setNewCollectionName(e.target.value);
                setNewCollectionError(null);
              }}
            />
            <FolioButton variant="secondary" type="submit" disabled={creatingCollection}>
              Create & add
            </FolioButton>
          </form>
          {newCollectionError && (
            <p className="folio-form__error" role="alert">
              {newCollectionError}
            </p>
          )}
        </div>
      </FolioDialog>

      {/* Duplicate dialog (06 §1.6): Skip / Keep both / Replace + L10 apply-all */}
      <FolioDialog
        open={duplicate !== null}
        onClose={() => resolveDuplicate("skip")}
        title="Already in your library"
        actions={
          <>
            <FolioButton
              variant="secondary"
              onClick={() => resolveDuplicate("skip", duplicateApplyAll)}
            >
              Skip
            </FolioButton>
            <FolioButton
              variant="secondary"
              onClick={() => resolveDuplicate("keep", duplicateApplyAll)}
            >
              Keep both
            </FolioButton>
            <FolioButton
              variant="primary"
              onClick={() => resolveDuplicate("replace", duplicateApplyAll)}
            >
              Replace
            </FolioButton>
          </>
        }
      >
        <p>
          A document with the same content ({duplicate?.title}) already exists. Replace keeps the
          old position, notes and collections.
        </p>
        <label className="folio-check-row">
          <input
            type="checkbox"
            checked={duplicateApplyAll}
            onChange={(e) => setDuplicateApplyAll(e.target.checked)}
          />
          <span>Apply this choice to all remaining duplicates in this batch</span>
        </label>
      </FolioDialog>

      {/* Import progress (Step 3.2): one dialog per batch, Cancel stops after
          the file in flight so the manifest never ends up half-written. */}
      <FolioDialog
        open={importProgress !== null}
        onClose={cancelImport}
        title="Importing"
        actions={
          <FolioButton variant="secondary" onClick={cancelImport}>
            Cancel
          </FolioButton>
        }
      >
        <p>
          File {importProgress?.index ?? 0} of {importProgress?.total ?? 0}:{" "}
          <strong>{importProgress?.name}</strong>
        </p>
        <div
          className="folio-book-row__progress"
          style={{ width: "100%" }}
          role="progressbar"
          aria-label="Importing files"
          aria-valuemin={0}
          aria-valuemax={importProgress?.total ?? 0}
          aria-valuenow={importProgress?.index ?? 0}
        >
          <div
            className="folio-book-row__progress-fill"
            style={{
              width:
                importProgress && importProgress.total > 0
                  ? `${Math.round((importProgress.index / importProgress.total) * 100)}%`
                  : "0%",
            }}
          />
        </div>
      </FolioDialog>

      {/* Recovery dialog (06 §1.9): L10 — stays open, with Remove all */}
      <FolioDialog
        open={recoveryDialogOpen}
        onClose={() => setRecoveryDialogOpen(false)}
        title="Library recovery"
        actions={
          <>
            {recovery && recovery.damaged.length + recovery.interrupted.length > 1 && (
              <FolioButton
                variant="danger"
                onClick={() => {
                  const all = [
                    ...recovery.damaged.map((d) => () => removeDamaged(d.id, d.slug)),
                    ...recovery.interrupted.map((d) => () => removeInterrupted(d.slug)),
                  ];
                  void Promise.allSettled(all.map((f) => f()));
                }}
              >
                Remove all
              </FolioButton>
            )}
            <FolioButton variant="primary" onClick={() => setRecoveryDialogOpen(false)}>
              Done
            </FolioButton>
          </>
        }
      >
        {recovery?.damaged.map((d) => (
          <div key={d.id} className="folio-settings-row">
            <div className="folio-settings-row__body">
              <div className="folio-settings-row__title">{d.title}</div>
              <div className="folio-settings-row__helper">Damaged — remove the leftover files?</div>
            </div>
            <div className="folio-settings-row__control">
              <FolioButton variant="danger" onClick={() => void removeDamaged(d.id, d.slug)}>
                Remove
              </FolioButton>
            </div>
          </div>
        ))}
        {recovery?.interrupted.map((d) => (
          <div key={d.slug} className="folio-settings-row">
            <div className="folio-settings-row__body">
              <div className="folio-settings-row__title">{d.slug}</div>
              <div className="folio-settings-row__helper">
                Interrupted import — delete leftover?
              </div>
            </div>
            <div className="folio-settings-row__control">
              <FolioButton variant="danger" onClick={() => void removeInterrupted(d.slug)}>
                Delete
              </FolioButton>
            </div>
          </div>
        ))}
      </FolioDialog>
    </>
  );
}
