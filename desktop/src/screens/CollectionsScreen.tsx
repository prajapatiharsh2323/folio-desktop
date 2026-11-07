import { useCallback, useEffect, useState } from "react";
import { FolioButton } from "../components/FolioButton";
import { FolioDialog } from "../components/FolioDialog";
import { FolioEmptyState } from "../components/FolioEmptyState";
import { FolioIcons } from "../components/FolioIcons";
import { FolioRow } from "../components/FolioRow";
import { useRouteStore, type ReaderOrigin } from "../store/routeStore";
import { getLibraryManager } from "../store/libraryUi";
import { getCollectionCoverPreset } from "../lib/coverPresets";
import type { Collection, ManifestDoc } from "../model/types";

/** Collections gallery + detail (03 §5.5, 06 §1/§2). */
export function CollectionsScreen() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [manifestDocs, setManifestDocs] = useState<ManifestDoc[]>([]);
  // Returning from the reader restores the collection the user came from;
  // readerOrigin survives closeReader exactly long enough to be read here.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => useRouteStore.getState().readerOrigin?.collectionId ?? null
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  const openReader = useRouteStore((s) => s.openReader);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const lm = getLibraryManager();
      const manifest = await lm.load();
      setManifestDocs(manifest?.docs ?? []);
      setCollections(await lm.collections.list());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Collections could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = collections.find((c) => c.id === selectedId) ?? null;

  /**
   * One gate for every collection action: prevents concurrent submissions,
   * clears the previous error, and keeps dialogs open on failure so the user
   * can retry or cancel instead of losing their input.
   */
  const runOp = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That change didn't go through.");
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const createCollection = () =>
    runOp(async () => {
      const name = createName.trim();
      if (!name) return;
      const lm = getLibraryManager();
      await lm.createCollection(name);
      setCreateName("");
      setCreateOpen(false);
      await load();
    });

  const renameCollection = () =>
    runOp(async () => {
      if (!selected) return;
      const name = renameName.trim();
      if (!name) return;
      const lm = getLibraryManager();
      await lm.renameCollection(selected.id, name);
      setRenameOpen(false);
      await load();
    });

  const deleteCollection = () =>
    runOp(async () => {
      if (!selected) return;
      const lm = getLibraryManager();
      await lm.deleteCollection(selected.id);
      setSelectedId(null);
      setDeleteOpen(false);
      await load();
    });

  const addMembers = () =>
    runOp(async () => {
      if (!selected) return;
      const lm = getLibraryManager();
      await lm.mutateCollectionDocs(selected.id, { add: [...pickerSelected] });
      setPickerSelected(new Set());
      setPickerOpen(false);
      await load();
    });

  const removeMember = (docId: string) =>
    runOp(async () => {
      if (!selected) return;
      const lm = getLibraryManager();
      await lm.mutateCollectionDocs(selected.id, { remove: [docId] });
      await load();
    });

  const openMember = (docId: string) =>
    runOp(async () => {
      if (!selected) return;
      const origin: ReaderOrigin = {
        route: "collections",
        collectionId: selected.id,
      };
      openReader({ docId }, origin);
    });

  const titleOf = (id: string) => manifestDocs.find((d) => d.id === id)?.title ?? null;

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
          ) : loadError ? (
            <FolioEmptyState
              title="Collections couldn't load"
              body={loadError}
              action={
                <FolioButton variant="secondary" onClick={() => void load()}>
                  Retry
                </FolioButton>
              }
            />
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
                  <div className="folio-collection-card__banner" aria-hidden="true">
                    <img
                      src={getCollectionCoverPreset(c.id)}
                      alt=""
                      className="folio-collection-card__banner-img"
                    />
                    <div className="folio-collection-card__banner-scrim" />
                    <span className="folio-collection-card__badge">Collection</span>
                  </div>
                  <div className="folio-collection-card__info">
                    <div className="folio-collection-card__name">{c.name}</div>
                    <div className="folio-collection-card__meta">
                      {c.docIds.length} item{c.docIds.length === 1 ? "" : "s"}
                      {c.updatedAt ? ` · updated ${new Date(c.updatedAt).toLocaleDateString()}` : ""}
                    </div>
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
              <FolioButton variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>
                Cancel
              </FolioButton>
              <FolioButton variant="primary" onClick={() => void createCollection()} disabled={busy}>
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

        {error && (
          <div className="folio-snackbar folio-snackbar--warn" role="alert">
            {error}
          </div>
        )}
      </>
    );
  }

  // ---- Detail ----
  const members = selected.docIds.map((id) => {
    const found = titleOf(id);
    // Collections keep docIds of docs the manifest no longer lists (a damaged
    // folder was pruned, or a backup merge removed it): surface that instead
    // of offering a dead open action.
    return {
      id,
      title: found ?? "Untitled",
      missing: found === null,
    };
  });
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
        <div className="folio-collection-hero" aria-hidden="true">
          <img
            src={getCollectionCoverPreset(selected.id)}
            alt=""
            className="folio-collection-hero__img"
          />
          <div className="folio-collection-hero__scrim" />
          <div className="folio-collection-hero__content">
            <span className="folio-collection-card__badge">Collection</span>
            <div className="folio-collection-hero__title">{selected.name}</div>
            <div className="folio-collection-hero__meta">
              {members.length} item{members.length === 1 ? "" : "s"}
              {selected.updatedAt ? ` · updated ${new Date(selected.updatedAt).toLocaleDateString()}` : ""}
            </div>
          </div>
        </div>

        {members.length === 0 ? (
          <FolioEmptyState
            title="Empty collection"
            body="Add books from your library."
          />
        ) : (
          <div className="folio-collection-members">
            {members.map((m) => (
              // Row stays a div: a row-level button wrapping the remove action
              // would nest buttons. Title and remove are separate controls.
              <FolioRow key={m.id}>
                <button
                  type="button"
                  className="folio-collection-member__open"
                  onClick={() => void openMember(m.id)}
                  title={m.missing ? "This book is no longer in your library" : m.title}
                  aria-label={
                    m.missing ? `${m.title} (missing from library)` : `Open ${m.title}`
                  }
                  disabled={m.missing}
                >
                  <span className="folio-collection-member__title">
                    {m.title}
                    {m.missing && (
                      <span className="folio-collection-member__missing"> · missing</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className="folio-iconbtn"
                  aria-label={`Remove ${m.title}`}
                  disabled={busy}
                  onClick={() => void removeMember(m.id)}
                >
                  <FolioIcons.Close size="sm" />
                </button>
              </FolioRow>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="folio-snackbar folio-snackbar--warn" role="alert">
          {error}
        </div>
      )}

      <FolioDialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename collection"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setRenameOpen(false)} disabled={busy}>
              Cancel
            </FolioButton>
            <FolioButton variant="primary" onClick={() => void renameCollection()} disabled={busy}>
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
            <FolioButton variant="secondary" onClick={() => setDeleteOpen(false)} disabled={busy}>
              Cancel
            </FolioButton>
            <FolioButton variant="danger" onClick={() => void deleteCollection()} disabled={busy}>
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
              disabled={pickerSelected.size === 0 || busy}
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
