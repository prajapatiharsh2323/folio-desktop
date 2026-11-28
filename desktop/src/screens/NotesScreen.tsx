import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolioButton } from "../components/FolioButton";
import { FolioChip } from "../components/FolioChip";
import { FolioDialog } from "../components/FolioDialog";
import { FolioEmptyState } from "../components/FolioEmptyState";
import { FolioSkeletonRows } from "../components/FolioSkeleton";
import { FolioIcons } from "../components/FolioIcons";
import { FolioMenu, type FolioMenuItem, type ViewportRect } from "../components/FolioMenu";
import { useRouteStore } from "../store/routeStore";
import { getLibraryFs, getLibraryManager, subscribeLibraryChanges } from "../store/libraryUi";
import { pickExportDestPath } from "../lib/fileSource";
import { pushToast } from "../shell/toasts";
import type { Annotation, Chapter, HighlightColor } from "../model/types";
import { nowIso } from "../model/ids";
import { describeError, handleError } from "../lib/errorLog";

const SWATCH_CSS: Record<string, string> = {
  yellow: "var(--folio-swatch-yellow)",
  green: "var(--folio-swatch-green)",
  blue: "var(--folio-swatch-blue)",
  pink: "var(--folio-swatch-pink)",
};

const COLOURS = ["yellow", "green", "blue", "pink"] as const;
type ColourFilter = "all" | (typeof COLOURS)[number];
type Sort = "recent" | "book";
type Filter = "all" | "highlight" | "note" | "bookmark";

function kindLabel(a: Annotation): string {
  if (a.kind === "highlight") return "Highlight";
  if (a.kind === "note") return "Note";
  return "Bookmark";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

interface NoteGroup {
  docId: string;
  title: string;
  missing: boolean;
  items: Annotation[];
}

/** Recency key used for the default sort and the group order. */
function recencyOf(a: Annotation): string {
  return a.updatedAt || a.createdAt;
}

// ---- export builders (pure, exported for tests) -----------------------------

/** CSV quoting: wrap fields containing comma/quote/newline; double quotes. */
export function csvField(value: string): string {
  const v = value ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const CSV_HEADER = "book,kind,color,quote,prefix,suffix,note,chapter,created,updated,location";

/** N1: one CSV row per annotation, in the given (already sorted) order. */
export function buildNotesCsv(
  items: Annotation[],
  titleOf: (docId: string) => string,
  chapterOf: (a: Annotation) => string | null,
): string {
  const rows = [
    CSV_HEADER,
    ...items.map((a) =>
      [
        titleOf(a.docId),
        kindLabel(a),
        a.color ?? "",
        a.quote,
        a.prefix,
        a.suffix,
        a.note ?? "",
        chapterOf(a) ?? "",
        a.createdAt,
        a.updatedAt,
        a.location ?? "",
      ]
        .map(csvField)
        .join(","),
    ),
  ];
  return rows.join("\n");
}

/** N1: Markdown export grouped by book, one bullet per annotation. */
export function buildNotesMarkdown(
  groups: NoteGroup[],
  chapterOf: (a: Annotation) => string | null,
): string {
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const lines = [
    "# Folio notes",
    "",
    `Exported ${fmtDate(new Date().toISOString())} · ${count} item${count === 1 ? "" : "s"}`,
  ];
  for (const g of groups) {
    lines.push("", `## ${g.title}`, "");
    for (const a of g.items) {
      const bits: string[] = [`**${kindLabel(a)}**`];
      if (a.quote) bits.push(`“${a.quote}”`);
      if (a.note) bits.push(a.note);
      const where = [chapterOf(a), fmtDate(a.createdAt)].filter(Boolean).join(" · ");
      if (where) bits.push(where);
      lines.push(`- ${bits.join(" — ")}`);
    }
  }
  return lines.join("\n");
}

/** Notes screen (03 §5.6, 06 §3): filters + search + grouping, tap→open. */
export function NotesScreen() {
  const openReader = useRouteStore((s) => s.openReader);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [docTitles, setDocTitles] = useState<Record<string, string>>({});
  const [docChapters, setDocChapters] = useState<Record<string, Chapter[]>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [colourFilter, setColourFilter] = useState<ColourFilter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deleting, setDeleting] = useState<Annotation | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportAnchor, setExportAnchor] = useState<ViewportRect | null>(null);
  const [exporting, setExporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lm = getLibraryManager();
      const manifest = await lm.load();
      const titles: Record<string, string> = {};
      const chapters: Record<string, Chapter[]> = {};
      for (const d of manifest?.docs ?? []) {
        titles[d.id] = d.title;
        // N1: chapter names for the rows; a doc without meta just has none.
        try {
          const meta = await lm.meta.read(d.slug);
          if (meta?.chapters?.length) chapters[d.id] = meta.chapters;
        } catch {
          /* missing meta only loses the chapter label */
        }
      }
      setDocTitles(titles);
      setDocChapters(chapters);
      const all = await lm.annotations.list();
      setAnnotations(all);
    } catch (e) {
      handleError(e, { context: "notes.load" });
      setError(e instanceof Error ? e.message : "Notes could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // E7: re-load when the library manifest changes (import/restore/delete).
    return subscribeLibraryChanges(() => void refresh());
  }, [refresh]);

  /** Chapter display name for a row (N1); null when unknown. */
  const chapterOf = useCallback(
    (a: Annotation): string | null => {
      if (!a.chapterId) return null;
      const list = docChapters[a.docId];
      if (!list) return null;
      const hit = list.find((c) => c.id === a.chapterId || c.href === a.chapterId);
      return hit?.title ?? null;
    },
    [docChapters],
  );

  const titleOf = useCallback(
    (docId: string) => docTitles[docId] ?? "[missing document]",
    [docTitles],
  );

  // ---- filter → sort → group pipeline ---------------------------------------

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return annotations.filter((a) => {
      if (filter !== "all" && a.kind !== filter) return false;
      // Bookmarks are colourless; a colour filter excludes them.
      if (colourFilter !== "all" && a.color !== colourFilter) return false;
      if (q) {
        const hay = `${titleOf(a.docId)} ${a.quote} ${a.note ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [annotations, filter, colourFilter, search, titleOf]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      if (sort === "book") {
        const c = titleOf(a.docId).localeCompare(titleOf(b.docId), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (c !== 0) return c;
      }
      return recencyOf(b).localeCompare(recencyOf(a));
    });
    return out;
  }, [filtered, sort, titleOf]);

  /** Group by book; group order follows the sort (alpha under "book"). */
  const groups = useMemo<NoteGroup[]>(() => {
    const byDoc = new Map<string, NoteGroup>();
    for (const a of sorted) {
      let g = byDoc.get(a.docId);
      if (!g) {
        g = { docId: a.docId, title: titleOf(a.docId), missing: !docTitles[a.docId], items: [] };
        byDoc.set(a.docId, g);
      }
      g.items.push(a);
    }
    const list = [...byDoc.values()];
    if (sort === "recent") {
      list.sort((x, y) => recencyOf(y.items[0]).localeCompare(recencyOf(x.items[0])));
    }
    return list;
  }, [sorted, sort, docTitles, titleOf]);

  // ---- actions ---------------------------------------------------------------

  const openAt = (a: Annotation) => {
    if (!a.docId) return;
    openReader({
      docId: a.docId,
      location: a.location ?? undefined,
      anchor:
        a.quote && a.quote.trim() ? { quote: a.quote, prefix: a.prefix, suffix: a.suffix } : null,
    });
  };

  /** N1: recolour straight from the row — patch the list in place. */
  const setColour = async (a: Annotation, color: HighlightColor) => {
    if (busy) return;
    setBusy(true);
    try {
      const lm = getLibraryManager();
      await lm.annotations.update(a.id, { color, updatedAt: nowIso() });
      setAnnotations((prev) => prev.map((x) => (x.id === a.id ? { ...x, color } : x)));
    } catch (e) {
      handleError(e, {
        context: "notes.update",
        userMessage: describeError(e, "The colour could not be changed."),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleEditSave = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const lm = getLibraryManager();
      await lm.annotations.update(editing.id, {
        note: editDraft.trim() || null,
        updatedAt: nowIso(),
      });
      setEditing(null);
      await refresh();
    } catch (e) {
      // Keep the dialog open with the user's draft so a transient write
      // failure can be retried instead of silently discarding the edit.
      handleError(e, {
        context: "notes.update",
        userMessage: describeError(e, "The note could not be saved."),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      const lm = getLibraryManager();
      await lm.annotations.remove(deleting.id);
      setDeleting(null);
      await refresh();
    } catch (e) {
      handleError(e, {
        context: "notes.delete",
        userMessage: describeError(e, "The note could not be deleted."),
      });
    } finally {
      setBusy(false);
    }
  };

  // ---- export (N1) -----------------------------------------------------------

  const exportItems: FolioMenuItem[] = useMemo(
    () => [
      {
        key: "md",
        label: "Export Markdown (.md)",
        onSelect: () => void exportAs("md"),
      },
      { key: "csv", label: "Export CSV (.csv)", onSelect: () => void exportAs("csv") },
      {
        key: "copy",
        label: "Copy all to clipboard",
        onSelect: () => void copyAll(),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups],
  );

  const exportAs = async (fmt: "md" | "csv") => {
    if (exporting) return;
    setExporting(true);
    try {
      const chapterName = (a: Annotation) => chapterOf(a) ?? "";
      const content =
        fmt === "md"
          ? buildNotesMarkdown(groups, chapterOf)
          : buildNotesCsv(sorted, titleOf, chapterName);
      const path = await pickExportDestPath(fmt === "md" ? "folio-notes.md" : "folio-notes.csv");
      if (path) {
        await getLibraryFs().writeTextAtomic(path, content);
        pushToast({ tone: "success", text: `Exported ${sorted.length} item(s).` });
      }
      // Browser mode has no save dialog — download through a Blob instead.
      else if (!("__TAURI_INTERNALS__" in window)) {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fmt === "md" ? "folio-notes.md" : "folio-notes.csv";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      handleError(e, {
        context: "notes.export",
        userMessage: describeError(e, "The export could not be written."),
      });
    } finally {
      setExporting(false);
    }
  };

  const copyAll = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await navigator.clipboard.writeText(buildNotesMarkdown(groups, chapterOf));
      pushToast({ tone: "success", text: `Copied ${sorted.length} item(s) to the clipboard.` });
    } catch (e) {
      handleError(e, {
        context: "notes.export",
        userMessage: describeError(e, "The notes could not be copied."),
      });
    } finally {
      setExporting(false);
    }
  };

  // ---- render ----------------------------------------------------------------

  const count = filtered.length;
  const filterLabel: Record<Filter, string> = {
    all: "notes",
    highlight: "highlights",
    note: "notes",
    bookmark: "bookmarks",
  };
  const emptyBody: Record<Filter, string> = {
    all: "Highlights, notes, and bookmarks you make while reading appear here.",
    highlight: "Select text while reading to highlight it.",
    note: "Add a note from a highlight or bookmark while reading.",
    bookmark: "Bookmark a page from the reader to find it here.",
  };
  const nothingMatches = !loading && !error && annotations.length > 0 && count === 0;

  return (
    <>
      <header className="folio-toolbar">
        <div className="folio-toolbar__titles">
          <div className="folio-toolbar__title">Notes</div>
          <div className="folio-toolbar__subtitle">
            {count} item{count === 1 ? "" : "s"}
          </div>
        </div>
        <button
          type="button"
          className="folio-iconbtn"
          aria-label="Export notes"
          disabled={exporting || annotations.length === 0}
          onClick={(e) => {
            setExportAnchor(e.currentTarget.getBoundingClientRect());
            setExportOpen(true);
          }}
        >
          <FolioIcons.Download />
        </button>
      </header>

      <div className="folio-toolbar" style={{ paddingTop: 0 }}>
        {/* N1: text search over book title, quote and note text. */}
        <div className="folio-searchbar" style={{ flex: 1 }}>
          <input
            ref={searchRef}
            type="text"
            className="folio-searchbar__input"
            value={search}
            placeholder="Search quotes, notes, books…"
            aria-label="Search notes"
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="folio-iconbtn"
              aria-label="Clear search"
              onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}
            >
              <FolioIcons.Close size="sm" />
            </button>
          )}
        </div>
        <select
          className="folio-filter-select"
          value={sort}
          aria-label="Sort notes"
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="recent">Recent first</option>
          <option value="book">By book</option>
        </select>
      </div>

      <div
        className="folio-toolbar"
        role="group"
        aria-label="Note filters"
        style={{ paddingTop: 0 }}
      >
        {(["all", "highlight", "note", "bookmark"] as Filter[]).map((f) => (
          <FolioChip key={f} selected={filter === f} onClick={() => setFilter(f)}>
            {f === "all"
              ? "All"
              : f === "highlight"
                ? "Highlights"
                : f === "note"
                  ? "Notes"
                  : "Bookmarks"}
          </FolioChip>
        ))}
        {/* N1: colour filter — bookmarks are colourless and drop out. */}
        <span className="folio-note-colours" role="group" aria-label="Colour filter">
          <FolioChip selected={colourFilter === "all"} onClick={() => setColourFilter("all")}>
            Any colour
          </FolioChip>
          {COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              className={`folio-note-colour${colourFilter === c ? " folio-note-colour--on" : ""}`}
              style={{ background: SWATCH_CSS[c] }}
              aria-label={`Colour ${c}`}
              aria-pressed={colourFilter === c}
              onClick={() => setColourFilter(colourFilter === c ? "all" : c)}
            />
          ))}
        </span>
      </div>

      <div className="folio-screen">
        {loading ? (
          <FolioSkeletonRows rows={6} />
        ) : error ? (
          <FolioEmptyState
            title="Notes couldn't load"
            body={error}
            action={
              <FolioButton variant="secondary" onClick={() => void refresh()}>
                Retry
              </FolioButton>
            }
          />
        ) : annotations.length === 0 ? (
          <FolioEmptyState
            title={filter === "all" ? "No notes yet" : `No ${filterLabel[filter]} yet`}
            body={emptyBody[filter]}
          />
        ) : nothingMatches ? (
          <FolioEmptyState title="Nothing matches" body="Try a different filter or search term." />
        ) : (
          <div className="folio-notes-list">
            {groups.map((g) => (
              // N1: collapsible per-book groups with counts.
              <details key={g.docId} className="folio-notes-group" open>
                <summary>
                  <span className="folio-notes-group__title">{g.title}</span>
                  {g.missing && <span className="folio-note-row__badge">missing document</span>}
                  <span className="folio-notes-group__count">
                    {g.items.length} item{g.items.length === 1 ? "" : "s"}
                  </span>
                  <FolioIcons.ChevronDown size="sm" />
                </summary>
                {g.items.map((a) => {
                  const railColor =
                    a.kind === "bookmark"
                      ? "var(--folio-accent)"
                      : (SWATCH_CSS[a.color ?? "yellow"] ?? "var(--folio-swatch-yellow)");
                  const chapter = chapterOf(a);
                  return (
                    <div key={a.id} className="folio-note-row">
                      <button
                        type="button"
                        className="folio-note-row__open"
                        onClick={() => openAt(a)}
                        aria-label={`Open ${kindLabel(a)} in ${g.title}`}
                      >
                        <span
                          className="folio-note-row__rail"
                          style={{ background: railColor }}
                          aria-hidden="true"
                        />
                        <div className="folio-note-row__body">
                          <div className="folio-note-row__meta">
                            {/* N1: chapter + date on the row. */}
                            <span className="folio-note-row__badge">{fmtDate(a.createdAt)}</span>
                            {chapter && <span className="folio-note-row__badge">{chapter}</span>}
                            <span className="folio-note-row__badge">{kindLabel(a)}</span>
                            {a.note && <span className="folio-note-row__badge">Has note</span>}
                          </div>
                          {a.quote && <div className="folio-note-row__quote">{a.quote}</div>}
                          {a.note && <div className="folio-note-row__note">{a.note}</div>}
                        </div>
                      </button>
                      <div className="folio-note-row__actions">
                        {a.kind !== "bookmark" && (
                          <span
                            className="folio-note-row__swatches"
                            role="group"
                            aria-label="Change colour"
                          >
                            {COLOURS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                className={`folio-note-row__swatch${
                                  (a.color ?? "yellow") === c ? " folio-note-row__swatch--on" : ""
                                }`}
                                style={{ background: SWATCH_CSS[c] }}
                                aria-label={`Set colour ${c}`}
                                aria-pressed={(a.color ?? "yellow") === c}
                                disabled={busy}
                                onClick={() => void setColour(a, c)}
                              />
                            ))}
                          </span>
                        )}
                        <button
                          type="button"
                          className="folio-iconbtn"
                          aria-label="Edit note"
                          disabled={busy}
                          onClick={() => {
                            setEditing(a);
                            setEditDraft(a.note ?? "");
                          }}
                        >
                          <FolioIcons.NotePlus size="sm" />
                        </button>
                        <button
                          type="button"
                          className="folio-iconbtn"
                          aria-label="Delete"
                          disabled={busy}
                          onClick={() => setDeleting(a)}
                        >
                          <FolioIcons.Trash size="sm" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </details>
            ))}
          </div>
        )}
      </div>

      {exportOpen && (
        <FolioMenu
          anchorRect={exportAnchor}
          items={exportItems}
          onClose={() => setExportOpen(false)}
          label="Export notes"
        />
      )}

      <FolioDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit note"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </FolioButton>
            <FolioButton variant="primary" onClick={() => void handleEditSave()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </FolioButton>
          </>
        }
      >
        <textarea
          className="folio-note-input"
          rows={4}
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          aria-label="Note"
          autoFocus
          data-autofocus
        />
      </FolioDialog>

      <FolioDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this note?"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </FolioButton>
            <FolioButton variant="danger" onClick={() => void handleDelete()} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </FolioButton>
          </>
        }
      >
        <p className="folio-helper">This can't be undone.</p>
      </FolioDialog>
    </>
  );
}
