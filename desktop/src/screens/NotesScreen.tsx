import { useCallback, useEffect, useState } from "react";
import { FolioButton } from "../components/FolioButton";
import { FolioChip } from "../components/FolioChip";
import { FolioDialog } from "../components/FolioDialog";
import { FolioEmptyState } from "../components/FolioEmptyState";
import { FolioIcons } from "../components/FolioIcons";
import { useRouteStore } from "../store/routeStore";
import { getLibraryManager } from "../store/libraryUi";
import type { Annotation } from "../model/types";
import { nowIso } from "../model/ids";

const SWATCH_CSS: Record<string, string> = {
  yellow: "var(--folio-swatch-yellow)",
  green: "var(--folio-swatch-green)",
  blue: "var(--folio-swatch-blue)",
  pink: "var(--folio-swatch-pink)",
};

type Filter = "all" | "highlight" | "note" | "bookmark";

function kindLabel(a: Annotation): string {
  if (a.kind === "highlight") return "Highlight";
  if (a.kind === "note") return "Note";
  return "Bookmark";
}

/** Notes screen (03 §5.6, 06 §3): filter pills, color-rail rows, tap→open. */
export function NotesScreen() {
  const openReader = useRouteStore((s) => s.openReader);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [docTitles, setDocTitles] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deleting, setDeleting] = useState<Annotation | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const lm = getLibraryManager();
      const manifest = await lm.load();
      const titles: Record<string, string> = {};
      for (const d of manifest?.docs ?? []) titles[d.id] = d.title;
      setDocTitles(titles);
      const all = await lm.annotations.list();
      setAnnotations(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = annotations.filter((a) => {
    if (filter === "all") return true;
    if (filter === "highlight") return a.kind === "highlight";
    if (filter === "note") return a.kind === "note";
    return a.kind === "bookmark";
  });

  const openAt = (a: Annotation) => {
    if (!a.docId) return;
    openReader({
      docId: a.docId,
      location: a.location ?? undefined,
      anchor:
        a.quote && a.quote.trim()
          ? { quote: a.quote, prefix: a.prefix, suffix: a.suffix }
          : null,
    });
  };

  const handleEditSave = async () => {
    if (!editing) return;
    const lm = getLibraryManager();
    await lm.annotations.update(editing.id, {
      note: editDraft.trim() || null,
      updatedAt: nowIso(),
    });
    setEditing(null);
    await refresh();
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const lm = getLibraryManager();
    await lm.annotations.remove(deleting.id);
    setDeleting(null);
    await refresh();
  };

  const count = filtered.length;

  return (
    <>
      <header className="folio-toolbar">
        <div className="folio-toolbar__titles">
          <div className="folio-toolbar__title">Notes</div>
          <div className="folio-toolbar__subtitle">
            {count} item{count === 1 ? "" : "s"}
          </div>
        </div>
      </header>

      <div className="folio-toolbar" role="group" aria-label="Note filters" style={{ paddingTop: 0 }}>
        {(["all", "highlight", "note", "bookmark"] as Filter[]).map((f) => (
          <FolioChip
            key={f}
            selected={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === "all"
              ? "All"
              : f === "highlight"
                ? "Highlights"
                : f === "note"
                  ? "Notes"
                  : "Bookmarks"}
          </FolioChip>
        ))}
      </div>

      <div className="folio-screen">
        {loading ? (
          <p className="folio-helper">Loading…</p>
        ) : filtered.length === 0 ? (
          <FolioEmptyState
            title="No notes yet"
            body="Highlights and notes you make while reading appear here."
          />
        ) : (
          <div className="folio-notes-list">
            {filtered.map((a) => {
              const title = docTitles[a.docId] ?? "[missing document]";
              const missing = !docTitles[a.docId];
              const railColor =
                a.kind === "bookmark"
                  ? "var(--folio-accent)"
                  : SWATCH_CSS[a.color ?? "yellow"] ?? "var(--folio-swatch-yellow)";
              return (
                <div key={a.id} className="folio-note-row" role="button" tabIndex={0}
                  onClick={() => openAt(a)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openAt(a);
                  }}
                >
                  <span className="folio-note-row__rail" style={{ background: railColor }} aria-hidden="true" />
                  <div className="folio-note-row__body">
                    <div className="folio-note-row__meta">
                      <span className="folio-note-row__title">{title}</span>
                      {missing && <span className="folio-note-row__badge">missing document</span>}
                      <span className="folio-note-row__badge">{kindLabel(a)}</span>
                      {a.note && <span className="folio-note-row__badge">Has note</span>}
                    </div>
                    {a.quote && (
                      <div className="folio-note-row__quote">{a.quote}</div>
                    )}
                    {a.note && <div className="folio-note-row__note">{a.note}</div>}
                  </div>
                  <div className="folio-note-row__actions">
                    <button
                      type="button"
                      className="folio-iconbtn"
                      aria-label="Edit note"
                      onClick={(e) => {
                        e.stopPropagation();
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleting(a);
                      }}
                    >
                      <FolioIcons.Trash size="sm" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <FolioDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit note"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </FolioButton>
            <FolioButton variant="primary" onClick={() => void handleEditSave()}>
              Save
            </FolioButton>
          </>
        }
      >
        <textarea
          className="folio-note-input"
          rows={4}
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          autoFocus
        />
      </FolioDialog>

      <FolioDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this note?"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </FolioButton>
            <FolioButton variant="danger" onClick={() => void handleDelete()}>
              Delete
            </FolioButton>
          </>
        }
      >
        <p className="folio-helper">This can't be undone.</p>
      </FolioDialog>
    </>
  );
}
