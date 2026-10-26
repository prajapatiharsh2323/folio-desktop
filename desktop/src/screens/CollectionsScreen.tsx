import { useCallback, useEffect, useState } from "react";
import { FolioButton } from "../components/FolioButton";
import { FolioDialog } from "../components/FolioDialog";
import { FolioEmptyState } from "../components/FolioEmptyState";
import { FolioIcons } from "../components/FolioIcons";
import { FolioRow } from "../components/FolioRow";
import { getLibraryManager } from "../store/libraryUi";
import type { Collection, ManifestDoc } from "../model/types";

const TINT_VARS = [
  "var(--folio-tint-sage-grey)",
  "var(--folio-tint-parchment)",
  "var(--folio-tint-eucalyptus)",
  "var(--folio-tint-clay)",
  "var(--folio-tint-slate)",
  "var(--folio-tint-oat)",
  "var(--folio-tint-stone)",
  "var(--folio-tint-moss)",
];

/** Collections gallery + detail (03 §5.5, 06 §1/§2). */
export function CollectionsScreen() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [manifestDocs, setManifestDocs] = useState<ManifestDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const lm = getLibraryManager();
      const manifest = await lm.load();
      setManifestDocs(manifest?.docs ?? []);
      setCollections(await lm.collections.list());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = collections.find((c) => c.id === selectedId) ?? null;

  const createCollection = async () => {
    const name = createName.trim();
    if (!name) return;
    const lm = getLibraryManager();
    await lm.createCollection(name);
    setCreateName("");
    setCreateOpen(false);
    await load();
  };

  const renameCollection = async () => {
    if (!selected) return;
    const name = renameName.trim();
    if (!name) return;
    const lm = getLibraryManager();
    await lm.renameCollection(selected.id, name);
    setRenameOpen(false);
    await load();
  };

  const deleteCollection = async () => {
    if (!selected) return;
    const lm = getLibraryManager();
    await lm.deleteCollection(selected.id);
    setSelectedId(null);
    setDeleteOpen(false);
    await load();
  };

  const addMembers = async () => {
    if (!selected) return;
    const lm = getLibraryManager();
    await lm.mutateCollectionDocs(selected.id, { add: [...pickerSelected] });
    setPickerSelected(new Set());
    setPickerOpen(false);
    await load();
  };

  const removeMember = async (docId: string) => {
    if (!selected) return;
    const lm = getLibraryManager();
    await lm.mutateCollectionDocs(selected.id, { remove: [docId] });
    await load();
  };

  const titleOf = (id: string) =>
    manifestDocs.find((d) => d.id === id)?.title ?? "Untitled";

  // ---- Gallery ----
  if (!selected) {
    return (
      <>
        <header className="folio-toolbar">
          <div className="folio-toolbar__titles">
            <div className="folio-toolbar__title">Collections</div>
            <div className="folio-toolbar__subtitle">
              {collections.length} collection{collections.length === 1 ? "" : "s"}
            </div>
          </div>
          <button
            type="button"
            className="folio-iconbtn"
            aria-label="New collection"
            onClick={() => setCreateOpen(true)}
          >
            <FolioIcons.Plus />
          </button>
        </header>

        <div className="folio-screen">
          {loading ? (
            <p className="folio-helper">Loading…</p>
          ) : collections.length === 0 ? (
            <FolioEmptyState
              title="No collections yet"
              body="Group books into collections to organize your library."
            />
          ) : (
            <div className="folio-collections-grid">
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="folio-collection-card"
                  onClick={() => setSelectedId(c.id)}
                >
                  <div className="folio-collection-card__fan" aria-hidden="true">
                    {c.docIds.slice(0, 3).map((id, i) => (
                      <span
                        key={id}
                        className="folio-collection-card__fan-cover"
                        style={{
                          background: TINT_VARS[i % TINT_VARS.length],
                          transform: `rotate(${(i - 1) * 6}deg) translateX(${(i - 1) * 6}px)`,
                        }}
                      >
                        {titleOf(id).slice(0, 2).toUpperCase()}
                      </span>
                    ))}
                    {c.docIds.length === 0 && (
                      <span className="folio-collection-card__fan-cover folio-collection-card__fan-cover--empty">
                        <FolioIcons.Folder />
                      </span>
                    )}
                  </div>
                  <div className="folio-collection-card__name">{c.name}</div>
                  <div className="folio-collection-card__meta">
                    {c.docIds.length} item{c.docIds.length === 1 ? "" : "s"}
                    {c.updatedAt ? ` · updated ${new Date(c.updatedAt).toLocaleDateString()}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <FolioDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="New collection"
          actions={
            <>
              <FolioButton variant="secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </FolioButton>
              <FolioButton variant="primary" onClick={() => void createCollection()}>
                Create
              </FolioButton>
            </>
          }
        >
          <input
            type="text"
            className="folio-note-input"
            style={{ minHeight: 44 }}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Collection name"
            autoFocus
          />
        </FolioDialog>
      </>
    );
  }

  // ---- Detail ----
  const members = selected.docIds.map((id) => ({
    id,
    title: titleOf(id),
  }));
  const available = manifestDocs.filter((d) => !selected.docIds.includes(d.id));

  return (
    <>
      <header className="folio-toolbar">
        <div className="folio-toolbar__titles">
          <button
            type="button"
            className="folio-iconbtn"
            aria-label="Back to collections"
            onClick={() => setSelectedId(null)}
            style={{ marginLeft: -8 }}
          >
            <FolioIcons.Back />
          </button>
          <div>
            <div className="folio-toolbar__title">{selected.name}</div>
            <div className="folio-toolbar__subtitle">
              {members.length} item{members.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="folio-iconbtn"
          aria-label="Rename"
          onClick={() => {
            setRenameName(selected.name);
            setRenameOpen(true);
          }}
        >
          <FolioIcons.NotePlus size="sm" />
        </button>
        <button
          type="button"
          className="folio-iconbtn"
          aria-label="Add members"
          onClick={() => {
            setPickerSelected(new Set());
            setPickerOpen(true);
          }}
        >
          <FolioIcons.Plus />
        </button>
        <button
          type="button"
          className="folio-iconbtn"
          aria-label="Delete collection"
          onClick={() => setDeleteOpen(true)}
        >
          <FolioIcons.Trash size="sm" />
        </button>
      </header>

      <div className="folio-screen">
        {members.length === 0 ? (
          <FolioEmptyState
            title="Empty collection"
            body="Add books from your library."
          />
        ) : (
          <div className="folio-collection-members">
            {members.map((m) => (
              <FolioRow key={m.id} className="folio-row--clickable">
                <div className="folio-collection-member__title">{m.title}</div>
                <button
                  type="button"
                  className="folio-iconbtn"
                  aria-label={`Remove ${m.title}`}
                  onClick={() => void removeMember(m.id)}
                >
                  <FolioIcons.Close size="sm" />
                </button>
              </FolioRow>
            ))}
          </div>
        )}
      </div>

      <FolioDialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename collection"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setRenameOpen(false)}>
              Cancel
            </FolioButton>
            <FolioButton variant="primary" onClick={() => void renameCollection()}>
              Save
            </FolioButton>
          </>
        }
      >
        <input
          type="text"
          className="folio-note-input"
          style={{ minHeight: 44 }}
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          autoFocus
        />
      </FolioDialog>

      <FolioDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this collection?"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </FolioButton>
            <FolioButton variant="danger" onClick={() => void deleteCollection()}>
              Delete
            </FolioButton>
          </>
        }
      >
        <p className="folio-helper">
          The books themselves stay in your library; only the collection is removed.
        </p>
      </FolioDialog>

      <FolioDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add to collection"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setPickerOpen(false)}>
              Cancel
            </FolioButton>
            <FolioButton
              variant="primary"
              disabled={pickerSelected.size === 0}
              onClick={() => void addMembers()}
            >
              Add
            </FolioButton>
          </>
        }
      >
        <div className="folio-picker-list">
          {available.length === 0 ? (
            <p className="folio-helper">All books are already in this collection.</p>
          ) : (
            available.map((d) => (
              <label key={d.id} className="folio-picker-row">
                <input
                  type="checkbox"
                  checked={pickerSelected.has(d.id)}
                  onChange={(e) => {
                    setPickerSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(d.id);
                      else next.delete(d.id);
                      return next;
                    });
                  }}
                />
                <span>{d.title}</span>
              </label>
            ))
          )}
        </div>
      </FolioDialog>
    </>
  );
}
